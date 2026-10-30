// Release notes shown in Settings › What's New and Update history. Newest first.
import type { Lang } from './i18n'

export interface Release {
  version: string
  date: string // YYYY-MM-DD
  notes: Record<Lang, string[]>
}

export const CHANGELOG: Release[] = [
  {
    version: '1.5.1',
    date: '2026-10-30',
    notes: {
      en: [
        'Steadier scan outline: no more flicker or jumping; it glides smoothly and turns green when the page is locked',
        'Smoother camera preview (page detection now runs in the background)',
        'More accurate page edges on light tables and with uneven lighting',
      ],
      zh: ['扫描框更稳定：不再闪烁跳动，移动顺滑，对准文件后会变成绿色', '相机预览更流畅（文件识别改在后台进行）', '浅色桌面和光线不均时，文件边缘识别更准确'],
      ms: [
        'Bingkai imbasan lebih stabil: tiada lagi berkelip atau melompat; bergerak lancar dan bertukar hijau apabila halaman dikunci',
        'Pratonton kamera lebih lancar (pengesanan halaman kini berjalan di latar belakang)',
        'Tepi halaman lebih tepat di atas meja cerah dan dalam pencahayaan tidak sekata',
      ],
    },
  },
  {
    version: '1.5.0',
    date: '2026-10-30',
    notes: {
      en: [
        'Timestamp camera: see the watermark live on the camera, with a ticking clock, location and GPS coordinates',
        'Edit the watermark right in the camera, and save your own named templates (e.g. "Site check", "Clock in")',
        'Favorites on Home: pin up to 7 tools you use most (tap Edit)',
      ],
      zh: ['时间水印相机：拍照前就能在画面上看到水印，时间实时跳动，并显示地点和经纬度', '可在相机里直接修改水印，并保存成自己命名的模板（例如"巡店""打卡"）', '首页「常用」：最多固定 7 个常用功能（点「编辑」）'],
      ms: [
        'Kamera cap masa: lihat tera air secara langsung pada kamera, dengan jam berdetik, lokasi dan koordinat GPS',
        'Sunting tera air terus dalam kamera, dan simpan templat bernama anda sendiri (cth. "Semakan tapak", "Daftar masuk")',
        'Kegemaran di Utama: sematkan sehingga 7 alatan yang paling kerap digunakan (tekan Sunting)',
      ],
    },
  },
  {
    version: '1.4.0',
    date: '2026-10-30',
    notes: {
      en: [
        'Timestamp templates: Time & Location, On-Site, Clock-In, Digital Clock and Classic',
        'Add your own watermark to timestamps: company name and logo',
        'Location from your phone, plus a note line; 12/24-hour, position and size',
      ],
      zh: ['时间水印模板：时间地点、现场、打卡、电子钟、经典', '可在时间水印加上自己的水印：公司名和 Logo', '可用手机定位填地点，并加备注；支持 12/24 小时制、位置和大小调整'],
      ms: [
        'Templat cap masa: Masa & Lokasi, Di Tapak, Daftar Masuk, Jam Digital dan Klasik',
        'Tambah tera air anda sendiri pada cap masa: nama syarikat dan logo',
        'Lokasi dari telefon anda, serta baris catatan; 12/24 jam, kedudukan dan saiz',
      ],
    },
  },
  {
    version: '1.3.1',
    date: '2026-10-30',
    notes: {
      en: ['Fixed: AnyScan now opens without internet after your first visit (it could get stuck on the splash screen)'],
      zh: ['修复：首次打开后，没有网络也能正常打开 AnyScan（之前可能会卡在启动画面）'],
      ms: ['Dibaiki: AnyScan kini boleh dibuka tanpa internet selepas lawatan pertama (sebelum ini boleh tersekat di skrin pembuka)'],
    },
  },
  {
    version: '1.3.0',
    date: '2026-10-30',
    notes: {
      en: [
        'New in-app camera: live preview that outlines the page as you aim',
        'Single or Batch shooting: take many pages in a row, then edit them together',
        'Swipe or tap the mode strip to switch: Extract Text, ID Card, Scan, To Word, QR Code, ID Photo, Timestamp',
        'ID Card mode guides you through the front and back',
        'Flip camera, flash (where supported), and the system camera for full-resolution photos',
      ],
      zh: [
        '全新内置相机：实时预览，对准时自动框出文件边缘',
        '单张或多张连拍：一次拍多页，再一起编辑',
        '左右滑动或点选下方模式：提取文字、证件扫描、扫描、转 Word、二维码、证件照、时间水印',
        '证件模式会引导你依次拍正面和反面',
        '可切换前后镜头、闪光灯（支持的设备），也可改用系统相机拍全分辨率照片',
      ],
      ms: [
        'Kamera dalam aplikasi baharu: pratonton langsung yang menandakan tepi halaman semasa anda menghala',
        'Ambil Tunggal atau Kelompok: ambil banyak halaman berturut-turut, kemudian sunting bersama',
        'Leret atau tekan jalur mod untuk bertukar: Ekstrak Teks, Kad Pengenalan, Imbas, Ke Word, Kod QR, Foto Pasport, Cap Masa',
        'Mod Kad Pengenalan membimbing anda mengambil bahagian depan dan belakang',
        'Tukar kamera, lampu kilat (jika disokong), dan kamera sistem untuk foto resolusi penuh',
      ],
    },
  },
  {
    version: '1.2.0',
    date: '2026-10-30',
    notes: {
      en: [
        'Smarter Smart Scan: much better at finding the page edges on light tables, coloured ID cards, rotated paper and patterned backgrounds',
        'Appearance like our other apps: Match system / Light / Dark, with 4 light themes (Classic, Paper, Mint, Lavender) and 4 dark themes (Midnight, OLED Black, Slate, Grape)',
        "What's New, update history and an \"Update available\" prompt",
        'Storage details: see how much space AnyScan uses and how much your phone allows',
        'New launch splash screen',
        'Choose your language the first time you open AnyScan (English by default)',
      ],
      zh: [
        '智能扫描更准：浅色桌面、彩色证件、斜放的纸张和花纹背景都能更准确地找到边缘',
        '外观与我们其他 App 一致：跟随系统 / 浅色 / 深色，另有 4 种浅色主题（经典、纸张、薄荷、薰衣草）和 4 种深色主题（午夜、纯黑 OLED、石板、葡萄）',
        '新增"新功能介绍"、更新记录和"有新版本"提示',
        '存储空间详情：查看 AnyScan 已用多少、你的手机允许用多少',
        '全新启动画面',
        '首次打开时可选择语言（默认英文）',
      ],
      ms: [
        'Imbas Pintar lebih bijak: lebih tepat mengesan tepi halaman di atas meja cerah, kad pengenalan berwarna, kertas senget dan latar bercorak',
        'Paparan seperti aplikasi kami yang lain: Ikut sistem / Cerah / Gelap, dengan 4 tema cerah (Klasik, Kertas, Pudina, Lavender) dan 4 tema gelap (Tengah Malam, Hitam OLED, Batu Loh, Anggur)',
        'Apa Yang Baharu, sejarah kemas kini dan gesaan "Kemas kini tersedia"',
        'Butiran storan: lihat ruang yang digunakan AnyScan dan had telefon anda',
        'Skrin pembuka baharu',
        'Pilih bahasa kali pertama anda membuka AnyScan (Bahasa Inggeris secara lalai)',
      ],
    },
  },
  {
    version: '1.1.0',
    date: '2026-10-30',
    notes: {
      en: ['Redesigned bottom tab bar with evenly spaced tabs', '"Me" is now "Settings"', 'Share AnyScan with friends using a QR code or link'],
      zh: ['重新设计底部导航栏，按钮间距平均', '"我的"改为"设置"', '可用二维码或链接把 AnyScan 分享给朋友'],
      ms: ['Bar tab bawah direka semula dengan jarak sekata', '"Saya" kini "Tetapan"', 'Kongsi AnyScan dengan rakan melalui kod QR atau pautan'],
    },
  },
  {
    version: '1.0.0',
    date: '2026-10-30',
    notes: {
      en: [
        'First release: Smart Scan with edge detection and filters, ID Card, ID Photo, Timestamp',
        'Extract Text (OCR) in English, Malay and Chinese, export to Word',
        'Scan and create QR codes',
        'PDF tools: password lock, compress, merge, extract, reorder, sign, watermark, print',
        'English, 简体中文 and Bahasa Melayu',
      ],
      zh: ['首个版本：智能扫描（自动找边、滤镜）、证件扫描、证件照、时间水印', '提取文字（英文、马来文、中文），可转 Word', '扫描和生成二维码', 'PDF 工具：加密码、压缩、合并、提取、排序、签名、水印、打印', '支持 English、简体中文、Bahasa Melayu'],
      ms: [
        'Keluaran pertama: Imbas Pintar dengan pengesanan tepi dan penapis, Kad Pengenalan, Foto Pasport, Cap Masa',
        'Ekstrak Teks (OCR) dalam bahasa Inggeris, Melayu dan Cina, eksport ke Word',
        'Imbas dan cipta kod QR',
        'Alatan PDF: kunci kata laluan, mampat, gabung, ekstrak, susun, tandatangan, tera air, cetak',
        'English, 简体中文 dan Bahasa Melayu',
      ],
    },
  },
]

export const APP_VERSION = __APP_VERSION__

/** Compares dotted versions numerically: negative if a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}
