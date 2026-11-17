// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package imaging

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"io"
)

// PSD/PSB previews read only the merged composite image Photoshop stores after
// the layers; the layers are skipped unparsed (MM-67077 dropped oov/psd for its
// unbounded layer parsing). Memory is bounded by the declared resolution, which
// Decoder.MaxDecodedResolution checks through DecodeConfig before decoding.
// shortcut: Gray/RGB/CMYK at 8 or 16 bits, raw or RLE, extra channels (alpha) ignored;
// other files get no preview. Add modes here if users upload them.

func init() {
	image.RegisterFormat("psd", "8BPS", decodePSD, decodePSDConfig)
}

const (
	psdModeGray = 1
	psdModeRGB  = 3
	psdModeCMYK = 4

	psdMaxDimension = 300000 // PSB limit; PSD is 30000
)

var psdColorChannels = map[int]int{psdModeGray: 1, psdModeRGB: 3, psdModeCMYK: 4}

type psdHeader struct {
	psb           bool
	channels      int
	width, height int
	depth         int
	mode          int
}

func readPSDHeader(r io.Reader) (psdHeader, error) {
	var b [26]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return psdHeader{}, fmt.Errorf("psd: reading header: %w", err)
	}
	if string(b[:4]) != "8BPS" {
		return psdHeader{}, errors.New("psd: invalid signature")
	}
	version := binary.BigEndian.Uint16(b[4:])
	h := psdHeader{
		psb:      version == 2,
		channels: int(binary.BigEndian.Uint16(b[12:])),
		height:   int(binary.BigEndian.Uint32(b[14:])),
		width:    int(binary.BigEndian.Uint32(b[18:])),
		depth:    int(binary.BigEndian.Uint16(b[22:])),
		mode:     int(binary.BigEndian.Uint16(b[24:])),
	}
	if version != 1 && version != 2 {
		return psdHeader{}, fmt.Errorf("psd: unsupported version %d", version)
	}
	if h.width <= 0 || h.height <= 0 || h.width > psdMaxDimension || h.height > psdMaxDimension {
		return psdHeader{}, fmt.Errorf("psd: invalid dimensions %dx%d", h.width, h.height)
	}
	if h.depth != 8 && h.depth != 16 {
		return psdHeader{}, fmt.Errorf("psd: unsupported bit depth %d", h.depth)
	}
	n, ok := psdColorChannels[h.mode]
	if !ok {
		return psdHeader{}, fmt.Errorf("psd: unsupported color mode %d", h.mode)
	}
	if h.channels < n {
		return psdHeader{}, fmt.Errorf("psd: %d channels is too few for color mode %d", h.channels, h.mode)
	}
	return h, nil
}

func decodePSDConfig(r io.Reader) (image.Config, error) {
	h, err := readPSDHeader(r)
	if err != nil {
		return image.Config{}, err
	}
	model := map[int]color.Model{psdModeGray: color.GrayModel, psdModeRGB: color.RGBAModel, psdModeCMYK: color.CMYKModel}[h.mode]
	return image.Config{ColorModel: model, Width: h.width, Height: h.height}, nil
}

// readPSDUint reads a big-endian unsigned integer of size 2, 4 or 8 bytes.
func readPSDUint(r io.Reader, size int) (uint64, error) {
	var b [8]byte
	if _, err := io.ReadFull(r, b[8-size:]); err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint64(b[:]), nil
}

func skipPSD(r io.Reader, n uint64) error {
	if n > 1<<62 {
		return errors.New("psd: section too large")
	}
	_, err := io.CopyN(io.Discard, r, int64(n))
	return err
}

func decodePSD(r io.Reader) (image.Image, error) {
	br := bufio.NewReader(r)
	h, err := readPSDHeader(br)
	if err != nil {
		return nil, err
	}

	// PSB widens the layer/mask info length and the RLE row counts.
	layerLenSize, countSize := 4, 2
	if h.psb {
		layerLenSize, countSize = 8, 4
	}

	// Color mode data, image resources and layer/mask info are skipped.
	for _, lenSize := range []int{4, 4, layerLenSize} {
		n, err := readPSDUint(br, lenSize)
		if err != nil {
			return nil, fmt.Errorf("psd: reading section length: %w", err)
		}
		if err := skipPSD(br, n); err != nil {
			return nil, fmt.Errorf("psd: skipping section: %w", err)
		}
	}

	compression, err := readPSDUint(br, 2)
	if err != nil {
		return nil, fmt.Errorf("psd: reading compression: %w", err)
	}

	n := psdColorChannels[h.mode]
	bytesPerSample := h.depth / 8
	rowBytes := h.width * bytesPerSample

	var counts []int
	switch compression {
	case 0:
	case 1:
		// Per-row compressed sizes for every channel, channel by channel: keep
		// the color channels' and skip the rest.
		counts = make([]int, n*h.height)
		for i := range counts {
			c, err := readPSDUint(br, countSize)
			if err != nil {
				return nil, fmt.Errorf("psd: reading RLE counts: %w", err)
			}
			counts[i] = int(c)
		}
		if err := skipPSD(br, uint64((h.channels-n)*h.height*countSize)); err != nil {
			return nil, fmt.Errorf("psd: skipping RLE counts: %w", err)
		}
	default:
		return nil, fmt.Errorf("psd: unsupported compression %d", compression)
	}

	rect := image.Rect(0, 0, h.width, h.height)
	var img image.Image
	var pix []byte
	var stride, step int
	switch h.mode {
	case psdModeGray:
		g := image.NewGray(rect)
		img, pix, stride, step = g, g.Pix, g.Stride, 1
	case psdModeRGB:
		rgba := image.NewRGBA(rect)
		img, pix, stride, step = rgba, rgba.Pix, rgba.Stride, 4
		for i := 3; i < len(pix); i += 4 {
			pix[i] = 0xff
		}
	case psdModeCMYK:
		cmyk := image.NewCMYK(rect)
		img, pix, stride, step = cmyk, cmyk.Pix, cmyk.Stride, 4
	}

	row := make([]byte, rowBytes)
	var packed []byte
	for c := range n {
		for y := 0; y < h.height; y++ {
			if counts == nil {
				if _, err := io.ReadFull(br, row); err != nil {
					return nil, fmt.Errorf("psd: reading image data: %w", err)
				}
			} else {
				size := counts[c*h.height+y]
				// PackBits never grows a row by more than 1 byte per 128.
				if size > rowBytes+rowBytes/128+2 {
					return nil, fmt.Errorf("psd: RLE row of %d bytes is too large", size)
				}
				if cap(packed) < size {
					packed = make([]byte, size)
				}
				packed = packed[:size]
				if _, err := io.ReadFull(br, packed); err != nil {
					return nil, fmt.Errorf("psd: reading image data: %w", err)
				}
				if err := unpackBits(packed, row); err != nil {
					return nil, err
				}
			}

			out := pix[y*stride+c:]
			for x := 0; x < h.width; x++ {
				v := row[x*bytesPerSample] // big-endian: the high byte of a 16-bit sample
				if h.mode == psdModeCMYK {
					v = 0xff - v // Photoshop stores CMYK inverted, 0xff meaning no ink
				}
				out[x*step] = v
			}
		}
	}

	return img, nil
}

// unpackBits decodes one PackBits-compressed row into dst, which it must fill exactly.
func unpackBits(src, dst []byte) error {
	errRLE := errors.New("psd: corrupt RLE data")
	i, o := 0, 0
	for o < len(dst) {
		if i >= len(src) {
			return errRLE
		}
		n := int(int8(src[i]))
		i++
		switch {
		case n >= 0:
			n++
			if i+n > len(src) || o+n > len(dst) {
				return errRLE
			}
			copy(dst[o:], src[i:i+n])
			i += n
			o += n
		case n != -128:
			n = 1 - n
			if i >= len(src) || o+n > len(dst) {
				return errRLE
			}
			for k := range n {
				dst[o+k] = src[i]
			}
			i++
			o += n
		}
	}
	return nil
}
