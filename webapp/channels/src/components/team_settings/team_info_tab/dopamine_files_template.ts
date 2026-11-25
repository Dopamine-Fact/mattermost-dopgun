// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {TeamFilesFolder} from '@mattermost/types/drive';

const f = (name: string, description: string, children?: TeamFilesFolder[]): TeamFilesFolder => ({name, description, ...(children ? {children} : {})});

// The Dopamine studio's Files page layout. Descriptions are the studio's own Turkish wording and show above each
// open folder.
export const DOPAMINE_FILES_TEMPLATE: TeamFilesFolder[] = [
    {
        ...f('00_MANAGEMENT', 'Sözleşmeler, mali belgeler ve kişisel veriler. Erişimi kapalıdır, ekip bu klasörü göremez.', [
            f('CONTRACTS', 'Kanallar, serbest çalışanlar ve dış ortaklarla yapılan sözleşmeler.'),
            f('LICENSING', 'Oyuncak, kitap ve ürün (merchandise) lisans anlaşmaları.'),
            f('RIGHTS', 'Telif devirleri, müzik ve ses efekti lisansları.'),
            f('LEGAL', 'Hukuki belgeler ve yazışmalar.'),
            f('HR', 'Ekip belgeleri, portfolyolar ve izin kayıtları.'),
            f('FINANCE', 'Bütçe ve ödeme takibi.'),
        ]),
        access: 'admin',
    },
    {
        ...f('01_DOCTRINE', 'Stüdyonun nasıl ve neden çalıştığını anlatan belgeler. Diğer her şey buradan türer. Herkes okur, yalnızca adminler yazar.', [
            f('00_CONSTITUTION', 'Stüdyo anayasası ve çalışma ilkeleri.'),
            f('01_WORKFLOW', 'Çalışma düzeni, aşama geçiş (stage-gate) kriterleri, isimlendirme standardı, görev–klasör tablosu ve toplantı rutini.'),
            f('02_AESTHETICS', 'Sinematografi doktrini: derinlik, kadraj, renk ve oyunculuk kuralları.'),
            f('03_DEPARTMENT_GUIDES', 'Her departmanın el kitabı ve teslim kontrol listeleri.'),
            f('04_REVISION_GUIDE', 'Revizyonların nasıl verildiği, okunduğu ve kapatıldığı.'),
            f('05_ONBOARDING', 'Yeni gelenler için uyum programı ve terimler sözlüğü.'),
            f('06_LEARNING', 'Şirket içi eğitim notları ve nasıl yapılır kayıtları.'),
        ]),
        access: 'read',
    },
    {...f('02_PRODUCTION', 'Bölüm kanallarının ana klasörleri.'), kind: 'production'},
    {
        ...f('03_LIBRARY', 'Bölümden bağımsız, projede tekrar tekrar kullanılan varlıklar. Buradan kopyalanmaz, referans verilir.', [
            f('CHARACTERS', 'Karakter tasarımları, model sheet\'ler ve ifade tabloları.'),
            f('RIGS', 'Karakter rig\'leri ve sürüm kayıtları.'),
            f('PROPS', 'Tekrar kullanılan objeler.', [
                f('DESIGN', 'Obje tasarımları.'),
                f('BUILD', 'Obje yapımları.'),
            ]),
            f('BG_LIBRARY', 'Tekrar kullanılan mekânlar; katmanlı, her mekân kendi klasöründe.'),
            f('ANIMATION_LIB', 'Etiketlenmiş, tekrar kullanılabilir hareketler.'),
            f('AUDIO_LIB', 'Ses efektleri, tema müziği ve jenerik.'),
            f('TEMPLATES', 'Toon Boom, After Effects, Premiere ve kapanış (outro) şablonları.'),
            f('REFERENCE', 'Onaylanan ve reddedilen kareler.', [
                f('APPROVED', 'Onaylanan kareler.'),
                f('REJECTED', 'Reddedilen kareler.'),
            ]),
            f('LOCALIZATION', 'Terim sözlüğü, karakter adları, tekrarlanan replikler, bölgesel içerik kuralları ve yerelleştirilmiş görseller.'),
        ]),
        kind: 'library',
    },
    f('04_BRAND', 'Markanın görsel kimliği ve dışarıya giden her şey.', [
        f('STYLE_GUIDE', 'Renk paleti, tipografi, çizgi kuralları ve ışık.'),
        f('LOGO', 'Logo varyantları ve kullanım kuralları.'),
        f('KEY_ART', 'Ana görseller, posterler ve one-sheet\'ler.'),
        f('CHARACTER_ART', 'Pazarlama için hazırlanan karakter görselleri.'),
        f('BRAND_GUIDELINES', 'Lisans ortaklarına gönderilen marka kullanım kılavuzu.'),
        f('LICENSING_ASSETS', 'Ortaklara gönderilen görsel paketler ve onaylı tasarımlar.'),
        f('PITCH', 'Bible, sunumlar ve pitch deck\'ler.'),
        f('PRESS', 'Basın bültenleri, röportajlar ve medya haberleri.'),
        f('FESTIVALS', 'Festival başvuru dosyaları ve materyalleri.'),
    ]),
    {...f('05_PROJECTS', 'Diğer takımlarla paylaşılan klasörler. Bir klasöre sağ tıklayıp hangi takımlarda görüneceğini seçebilirsiniz.'), kind: 'projects'},
    f('06_ARCHIVE', 'Kapanmış işler ve kalıcı kayıtlar.', [
        f('DELIVERED', 'Teslim edilen bölümlerin master ve yayın kopyaları.', [
            f('S01', '1. sezon teslimleri.'),
            f('S02', '2. sezon teslimleri.'),
        ]),
        f('CHANNEL_DOCS', 'Kanalın teknik şartnameleri ve teslim formatları.'),
        f('PROJECT_DOCS', 'Sezon takvimleri, ekip listeleri ve toplantı notları.'),
        f('DEVELOPMENT', 'Kullanılmayan fikirler ve gelecek sezonlar için notlar.'),
        f('TECHNICAL', 'Yazılım lisansları, sunucu bilgileri ve kurulum notları.'),
    ]),
    {...f('07_CHANNELS', 'Takımın Mattermost kanallarının klasörleri ve dosyaları.'), kind: 'channels'},
];
