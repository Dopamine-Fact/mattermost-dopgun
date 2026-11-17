// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package imaging

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"testing"

	"github.com/stretchr/testify/require"
)

type testPSD struct {
	psb         bool
	mode, depth int
	channels    int
	w, h        int
	compression uint16
	planes      [][]byte // one per channel, raw rows; RLE-encoded as literal runs when compression is 1
}

func (p testPSD) bytes() []byte {
	var b bytes.Buffer
	be := func(v any) { _ = binary.Write(&b, binary.BigEndian, v) }
	b.WriteString("8BPS")
	be(uint16(map[bool]int{false: 1, true: 2}[p.psb]))
	b.Write(make([]byte, 6))
	be(uint16(p.channels))
	be(uint32(p.h))
	be(uint32(p.w))
	be(uint16(p.depth))
	be(uint16(p.mode))
	// Non-empty sections so skipping them is exercised.
	be(uint32(3))
	b.Write([]byte{1, 2, 3})
	be(uint32(2))
	b.Write([]byte{4, 5})
	if p.psb {
		be(uint64(1))
	} else {
		be(uint32(1))
	}
	b.WriteByte(6)
	be(p.compression)

	rowBytes := p.w * p.depth / 8
	if p.compression == 0 {
		for _, plane := range p.planes {
			b.Write(plane)
		}
		return b.Bytes()
	}
	var data bytes.Buffer
	for _, plane := range p.planes {
		for y := range p.h {
			row := plane[y*rowBytes : (y+1)*rowBytes]
			if p.psb {
				be(uint32(len(row) + 1))
			} else {
				be(uint16(len(row) + 1))
			}
			data.WriteByte(byte(len(row) - 1))
			data.Write(row)
		}
	}
	b.Write(data.Bytes())
	return b.Bytes()
}

func TestDecodePSD(t *testing.T) {
	d, err := NewDecoder(DecoderOptions{})
	require.NoError(t, err)

	t.Run("RGB 8-bit raw with alpha channel", func(t *testing.T) {
		data := testPSD{mode: psdModeRGB, depth: 8, channels: 4, w: 2, h: 1, planes: [][]byte{{10, 20}, {30, 40}, {50, 60}, {0, 0}}}.bytes()

		cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
		require.NoError(t, err)
		require.Equal(t, "psd", format)
		require.Equal(t, 2, cfg.Width)
		require.Equal(t, 1, cfg.Height)

		img, format, err := d.Decode(bytes.NewReader(data))
		require.NoError(t, err)
		require.Equal(t, "psd", format)
		require.Equal(t, color.RGBA{10, 30, 50, 255}, img.At(0, 0))
		require.Equal(t, color.RGBA{20, 40, 60, 255}, img.At(1, 0))
	})

	t.Run("RGB 8-bit RLE", func(t *testing.T) {
		data := testPSD{mode: psdModeRGB, depth: 8, channels: 3, w: 2, h: 2, compression: 1,
			planes: [][]byte{{1, 2, 3, 4}, {5, 6, 7, 8}, {9, 10, 11, 12}}}.bytes()
		img, _, err := d.Decode(bytes.NewReader(data))
		require.NoError(t, err)
		require.Equal(t, color.RGBA{4, 8, 12, 255}, img.At(1, 1))
	})

	t.Run("PSB gray 16-bit RLE", func(t *testing.T) {
		data := testPSD{psb: true, mode: psdModeGray, depth: 16, channels: 1, w: 2, h: 1, compression: 1,
			planes: [][]byte{{0x12, 0x34, 0xab, 0xcd}}}.bytes()
		img, _, err := d.Decode(bytes.NewReader(data))
		require.NoError(t, err)
		require.Equal(t, color.Gray{0x12}, img.At(0, 0))
		require.Equal(t, color.Gray{0xab}, img.At(1, 0))
	})

	t.Run("CMYK is stored inverted", func(t *testing.T) {
		data := testPSD{mode: psdModeCMYK, depth: 8, channels: 4, w: 1, h: 1, planes: [][]byte{{255}, {0}, {200}, {255}}}.bytes()
		img, _, err := d.Decode(bytes.NewReader(data))
		require.NoError(t, err)
		require.Equal(t, color.CMYK{0, 255, 55, 0}, img.At(0, 0))
	})

	t.Run("resolution limit applies", func(t *testing.T) {
		limited, err := NewDecoder(DecoderOptions{MaxDecodedResolution: 1})
		require.NoError(t, err)
		data := testPSD{mode: psdModeGray, depth: 8, channels: 1, w: 2, h: 1, planes: [][]byte{{1, 2}}}.bytes()
		_, _, err = limited.Decode(bytes.NewReader(data))
		require.ErrorIs(t, err, ErrResolutionLimit)
	})

	t.Run("rejects bad input", func(t *testing.T) {
		valid := testPSD{mode: psdModeGray, depth: 8, channels: 1, w: 2, h: 1, planes: [][]byte{{1, 2}}}.bytes()
		indexed := testPSD{mode: 2, depth: 8, channels: 1, w: 2, h: 1, planes: [][]byte{{1, 2}}}.bytes()
		hugeRow := testPSD{mode: psdModeGray, depth: 8, channels: 1, w: 2, h: 1, compression: 1, planes: [][]byte{{1, 2}}}.bytes()
		binary.BigEndian.PutUint16(hugeRow[len(hugeRow)-5:], 0xffff) // row count, before the 3 RLE bytes
		badRun := testPSD{mode: psdModeGray, depth: 8, channels: 1, w: 2, h: 1, compression: 1, planes: [][]byte{{1, 2}}}.bytes()
		badRun[len(badRun)-3] = 5 // literal run longer than the row

		for name, data := range map[string][]byte{
			"truncated":   valid[:len(valid)-1],
			"header only": []byte("8BPS\x00\x01"),
			"indexed":     indexed,
			"huge row":    hugeRow,
			"bad run":     badRun,
		} {
			_, _, err := d.Decode(bytes.NewReader(data))
			require.Error(t, err, name)
		}
	})
}

func TestUnpackBits(t *testing.T) {
	dst := make([]byte, 6)
	// literal [1 2], repeat 3x 7, no-op, literal [9]
	require.NoError(t, unpackBits([]byte{1, 1, 2, 0xfe, 7, 0x80, 0, 9}, dst))
	require.Equal(t, []byte{1, 2, 7, 7, 7, 9}, dst)

	require.Error(t, unpackBits([]byte{0xfe, 7}, make([]byte, 2)), "run overflows row")
	require.Error(t, unpackBits([]byte{0, 1}, make([]byte, 2)), "row left short")
}
