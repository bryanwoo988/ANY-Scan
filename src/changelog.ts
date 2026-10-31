// Release notes shown in Settings › What's New and Update history. Newest first.
import type { Lang } from './i18n'

export interface Release {
  version: string
  /** Publish time (UTC, ISO 8601). Leave out for the version being built: the build time is used. */
  released?: string
  notes: Record<Lang, string[]>
}

export const CHANGELOG: Release[] = [
  {
    version: '1.12.0',
    notes: {
      en: [
        'New: Long Screenshot — join screenshots taken while scrolling (a chat, an article, a receipt) into one long image (Tools › Scan)',
        'Repeated parts are cut out automatically, and the status bar and tab bar appear only once, even if the clock changed between screenshots',
        'Reorder screenshots, check each join and fine-tune it with ▲ / ▼; save as an image or into AnyScan (then export as PDF)',
      ],
      zh: ['新功能：长截图——把滑动时截的几张图（聊天记录、文章、收据）拼成一张长图（工具 › 扫描）', '会自动去掉重复的部分，状态栏和底部栏只保留一次，就算截图之间时间变了也可以', '可以调整截图顺序、检查每个接缝并用 ▲ / ▼ 微调；可保存为图片或存进 AnyScan（之后可导出 PDF）'],
      ms: [
        'Baharu: Tangkapan Skrin Panjang — sambung tangkapan skrin yang diambil semasa menatal (sembang, artikel, resit) menjadi satu imej panjang (Alatan › Imbas)',
        'Bahagian berulang dibuang secara automatik, dan bar status serta bar tab muncul sekali sahaja, walaupun jam berubah antara tangkapan skrin',
        'Susun semula tangkapan skrin, semak setiap sambungan dan laraskan dengan ▲ / ▼; simpan sebagai imej atau ke AnyScan (kemudian eksport sebagai PDF)',
      ],
    },
  },
  {
    version: '1.11.0',
    released: '2026-10-31T07:30:34Z',
    notes: {
      en: [
        'New: Convert to Excel — turn tables in photos, scans and PDFs into an editable .xlsx (Tools › Convert)',
        'Rows and columns are rebuilt from where the text sits; numbers become real numbers (8.90, 2,100.00 and 6% keep their look), while codes, IC and phone numbers stay as text',
        'Start from the camera, Photos, Files or a document already in AnyScan; preview the table before saving, one sheet per page or all in one',
        'PDFs use their own text; pictures are read on your phone with OCR, even slightly tilted photos and tables with grid lines',
      ],
      zh: ['新功能：转 Excel——把照片、扫描件和 PDF 里的表格转成可编辑的 .xlsx（工具 › 转换）', '会根据文字位置重建行和列；数字变成真正的数值（8.90、2,100.00、6% 保持原来的样子），编号、IC 和电话号码保持文字', '可以拍照、从相册、文件或 AnyScan 里的文件开始；保存前可以预览表格，每页一个工作表或全部放一起', 'PDF 直接用里面的文字；图片会在手机上用 OCR 识别，稍微歪的照片和有格线的表格也可以'],
      ms: [
        'Baharu: Tukar ke Excel — tukar jadual dalam foto, imbasan dan PDF kepada .xlsx yang boleh diedit (Alatan › Tukar)',
        'Baris dan lajur dibina semula daripada kedudukan teks; nombor menjadi nombor sebenar (8.90, 2,100.00 dan 6% kekal rupanya), manakala kod, nombor IC dan telefon kekal sebagai teks',
        'Mula daripada kamera, Foto, Fail atau dokumen dalam AnyScan; pratonton jadual sebelum menyimpan, satu helaian setiap halaman atau semua dalam satu',
        'PDF menggunakan teksnya sendiri; gambar dibaca di telefon dengan OCR, termasuk foto yang sedikit senget dan jadual bergaris',
      ],
    },
  },
  {
    version: '1.10.1',
    released: '2026-10-31T07:19:17Z',
    notes: {
      en: ['"Scan to Word" is now called "To Text" (it still saves as text or Word)'],
      zh: ['「扫描转 Word」改名为「转文字」（一样可以保存为文字或 Word）'],
      ms: ['"Imbas ke Word" kini dipanggil "Ke Teks" (masih boleh disimpan sebagai teks atau Word)'],
    },
  },
  {
    version: '1.10.0',
    released: '2026-10-31T05:38:26Z',
    notes: {
      en: [
        'New: PDF to Word — editable text with headings and paragraphs kept, or "Exact look" with every page as a picture. Scanned pages are read with OCR',
        'New: PDF to PowerPoint — one slide per page that looks exactly like the PDF, or editable text boxes in the same places',
        'Both are in Tools › Convert and work on your phone; the file never leaves it',
        'New tools now show a NEW badge until you try them',
        '"To Word" is now called "Scan to Word"',
      ],
      zh: ['新功能：PDF 转 Word——可编辑文字（保留标题和段落），或「保持原样」把每页作为图片放进去。扫描的页面会用 OCR 识别', '新功能：PDF 转 PPT——每页一张幻灯片，和 PDF 一模一样；或变成同样位置的可编辑文本框', '两个都在「工具 › 转换」，全部在手机上完成，文件不会上传', '新工具会显示「新」标记，用过一次后消失', '「转 Word」改名为「扫描转 Word」'],
      ms: [
        'Baharu: PDF ke Word — teks boleh edit dengan tajuk dan perenggan dikekalkan, atau "Rupa asal" dengan setiap halaman sebagai gambar. Halaman imbasan dibaca dengan OCR',
        'Baharu: PDF ke PowerPoint — satu slaid setiap halaman yang sama seperti PDF, atau kotak teks boleh edit di tempat yang sama',
        'Kedua-duanya dalam Alatan › Tukar dan berjalan di telefon anda; fail tidak pernah keluar',
        'Alatan baharu kini menunjukkan lencana BAHARU sehingga anda mencubanya',
        '"Ke Word" kini dipanggil "Imbas ke Word"',
      ],
    },
  },
  {
    version: '1.9.1',
    released: '2026-10-31T04:24:36Z',
    notes: {
      en: ['Watermark: new "Two corners" style — slanted text across the top-left and bottom-right corners of the card (or top-right and bottom-left), half on the card and half on the paper, the way people mark IC copies'],
      zh: ['水印：新增「对角」款式——斜写的字跨过证件的左上角和右下角（或右上角和左下角），一半在证件上、一半在纸上，就像大家在 IC 复印件上写的那样'],
      ms: ['Tera air: gaya baharu "Dua penjuru" — teks condong merentasi penjuru atas kiri dan bawah kanan kad (atau atas kanan dan bawah kiri), separuh pada kad dan separuh pada kertas, seperti yang biasa ditulis pada salinan IC'],
    },
  },
  {
    version: '1.9.0',
    released: '2026-10-31T04:10:33Z',
    notes: {
      en: [
        'Watermark: 5 styles to choose from, each previewed on your own page — Diagonal, Across lines, Corner, Stamp and Repeat',
        'Finds the ID card or photo on the page and puts the watermark only on it (front and back each get their own); switch to "Whole page" any time',
        'Corner and Stamp: pick top-left, top-right, bottom-left, bottom-right (or centre for Stamp) and the angle',
        "Optional second line with today's date; your style and settings are remembered",
      ],
      zh: ['水印：5 种款式可选，并直接用你的页面预览——斜跨、斜线、角落、印章、平铺', '会自动找到页面上的证件或照片，只把水印放在上面（正反面各放一个）；也可随时改成「整页」', '角落和印章可选左上、右上、左下、右下（印章还可放中间），并可调角度', '可加第二行今天的日期；款式和设置会记住'],
      ms: [
        'Tera air: 5 gaya untuk dipilih, setiap satu dipratonton pada halaman anda — Pepenjuru, Garisan silang, Penjuru, Cop dan Berulang',
        'Mengesan kad pengenalan atau foto pada halaman dan meletakkan tera air hanya padanya (depan dan belakang masing-masing); tukar ke "Seluruh halaman" bila-bila masa',
        'Penjuru dan Cop: pilih atas kiri, atas kanan, bawah kiri, bawah kanan (atau tengah untuk Cop) dan sudut',
        'Baris kedua pilihan dengan tarikh hari ini; gaya dan tetapan anda diingati',
      ],
    },
  },
  {
    version: '1.8.1',
    released: '2026-10-31T02:37:43Z',
    notes: {
      en: [
        'Batch select: tap "Select" in Documents, then tap files, or slide your finger along the checkboxes to pick many at once (the list scrolls when you reach the edge; slide back to undo)',
        'Select all / Deselect all, then Move to album, Merge or Delete in one go',
        'Long-press a file → "Select" to start selecting from it',
        'Recycle Bin: select several items to restore or delete them together',
      ],
      zh: ['批量选择：在文件页点「选择」，再点文件；或手指按住勾选框上下滑动，一次选很多个（滑到边缘会自动滚动，往回滑可取消）', '可一键全选/取消全选，然后一起移到相册、合并或删除', '按住文件 →「选择」，从这个文件开始多选', '回收站也能多选，一次恢复或永久删除多个项目'],
      ms: [
        'Pilih berkelompok: ketik "Pilih" dalam Dokumen, kemudian ketik fail, atau leret jari sepanjang kotak semak untuk memilih banyak sekaligus (senarai menatal apabila sampai ke tepi; leret balik untuk batal)',
        'Pilih semua / Nyahpilih semua, kemudian Pindah ke album, Gabung atau Padam sekali gus',
        'Tekan lama fail → "Pilih" untuk mula memilih dari fail itu',
        'Tong Kitar Semula: pilih beberapa item untuk dipulihkan atau dipadam bersama',
      ],
    },
  },
  {
    version: '1.8.0',
    released: '2026-10-31T01:38:32Z',
    notes: {
      en: [
        'Swipe a file left for Rename, Album and Delete; long-press for more (Open, Move to album, Share, Duplicate…) — on Home and in Documents',
        'Albums in Documents: create albums (Receipts, Work, Photos…), move files in, rename or delete albums',
        'Recycle Bin: deleted files and albums are kept for 30 days and can be restored, then removed automatically. Delete shows an Undo button',
      ],
      zh: ['文件向左滑可重命名、移到相册、删除；按住可看更多选项（打开、移到相册、分享、复制…），首页和文件页都可以', '文件页新增相册：可建立相册（收据、工作、照片…），把文件移进去，相册可改名或删除', '回收站：删除的文件和相册会保留 30 天，可随时恢复，30 天后自动清除。删除后会出现「撤销」按钮'],
      ms: [
        'Leret fail ke kiri untuk Namakan semula, Album dan Padam; tekan lama untuk lagi (Buka, Pindah ke album, Kongsi, Salin…) — di Utama dan Dokumen',
        'Album dalam Dokumen: cipta album (Resit, Kerja, Foto…), pindahkan fail, namakan semula atau padam album',
        'Tong Kitar Semula: fail dan album yang dipadam disimpan 30 hari dan boleh dipulihkan, kemudian dibuang secara automatik. Padam menunjukkan butang Buat asal',
      ],
    },
  },
  {
    version: '1.7.2',
    released: '2026-10-31T00:47:03Z',
    notes: {
      en: ['Timestamp: turn the time & info off to put only your watermarks on the photo (quick "Time on/off" button in the camera; saved with combinations)'],
      zh: ['时间水印：可关闭时间与信息，照片上只保留你的水印（相机里有「时间：开/关」快捷按钮，也会保存在组合里）'],
      ms: ['Cap masa: matikan masa & maklumat untuk letak hanya tera air anda pada foto (butang pantas "Masa: on/off" dalam kamera; disimpan bersama gabungan)'],
    },
  },
  {
    version: '1.7.1',
    released: '2026-10-30T22:48:43Z',
    notes: {
      en: ['Fixed: on some iPhones (e.g. iPhone 17 Pro Max) the page was taller than the screen and the bottom tab bar was only visible after scrolling down'],
      zh: ['修复：部分 iPhone（例如 iPhone 17 Pro Max）页面比屏幕高，底部导航栏要往下滑才看得到'],
      ms: ['Dibaiki: pada sesetengah iPhone (cth. iPhone 17 Pro Max) halaman lebih tinggi daripada skrin dan bar tab bawah hanya kelihatan selepas menatal ke bawah'],
    },
  },
  {
    version: '1.7.0',
    released: '2026-10-30T21:59:42Z',
    notes: {
      en: [
        'Timestamp: keep as many watermarks as you like (company, client, personal…), each with its own text, logo, position and size',
        'Use several watermarks on one photo',
        'Combinations: save a date template + info settings + watermarks under a name, and switch between them with one tap in the camera',
        'Editing a watermark updates every combination that uses it',
      ],
      zh: ['时间水印：可建立多个水印（公司、客户、个人…），各有自己的文字、Logo、位置和大小', '一张照片可同时使用多个水印', '组合：把日期模板、信息设置和水印存成一个命名组合，在相机里一点就能切换', '修改一个水印，所有用到它的组合都会一起更新'],
      ms: [
        'Cap masa: simpan seberapa banyak tera air (syarikat, pelanggan, peribadi…), setiap satu dengan teks, logo, kedudukan dan saiz sendiri',
        'Guna beberapa tera air pada satu foto',
        'Gabungan: simpan templat tarikh + tetapan maklumat + tera air di bawah satu nama, dan tukar dengan satu ketikan dalam kamera',
        'Menyunting tera air mengemas kini setiap gabungan yang menggunakannya',
      ],
    },
  },
  {
    version: '1.6.1',
    released: '2026-10-30T21:27:13Z',
    notes: {
      en: [
        'Timestamp: the time/info group and your watermark (logo + text) now each have their own position and size',
        'Six positions to choose from: top or bottom, left, centre or right',
      ],
      zh: ['时间水印：时间信息和你的水印（Logo + 文字）分开，各自调整位置和大小', '可选 6 个位置：上方或下方的左、中、右'],
      ms: ['Cap masa: kumpulan masa/maklumat dan tera air anda (logo + teks) kini mempunyai kedudukan dan saiz sendiri', 'Enam kedudukan untuk dipilih: atas atau bawah, kiri, tengah atau kanan'],
    },
  },
  {
    version: '1.6.0',
    released: '2026-10-30T21:16:24Z',
    notes: {
      en: [
        'Camera zoom: pinch on the preview or tap 1× / 2× / 3×; the photo is exactly what you see',
        'Grid lines and a self-timer (3 s / 10 s) in the camera',
        'Auto-capture in Scan mode: takes the photo by itself once the page outline turns green',
        'Timestamp: separate Logo size slider (up to 4×)',
      ],
      zh: ['相机缩放：在画面上双指缩放，或点 1× / 2× / 3×；拍到的就是画面上看到的', '相机新增网格线和定时拍照（3 秒 / 10 秒）', '扫描模式新增「自动拍」：文件框变绿后会自动拍照', '时间水印：可单独调整 Logo 大小（最大 4 倍）'],
      ms: [
        'Zum kamera: cubit pada pratonton atau tekan 1× / 2× / 3×; foto sama seperti yang anda lihat',
        'Garis grid dan pemasa (3 s / 10 s) dalam kamera',
        'Ambil automatik dalam mod Imbas: foto diambil sendiri apabila bingkai halaman bertukar hijau',
        'Cap masa: gelangsar Saiz logo berasingan (sehingga 4×)',
      ],
    },
  },
  {
    version: '1.5.2',
    released: '2026-10-30T21:09:11Z',
    notes: {
      en: ['Update dates are now shown in your phone\'s time zone, with the time of release'],
      zh: ['更新记录的日期改为按手机所在时区显示，并加上发布时间'],
      ms: ['Tarikh kemas kini kini dipaparkan mengikut zon waktu telefon anda, bersama masa keluaran'],
    },
  },
  {
    version: '1.5.1',
    released: '2026-10-30T21:07:32Z',
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
    released: '2026-10-30T20:47:42Z',
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
    released: '2026-10-30T15:52:38Z',
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
    released: '2026-10-30T15:46:51Z',
    notes: {
      en: ['Fixed: AnyScan now opens without internet after your first visit (it could get stuck on the splash screen)'],
      zh: ['修复：首次打开后，没有网络也能正常打开 AnyScan（之前可能会卡在启动画面）'],
      ms: ['Dibaiki: AnyScan kini boleh dibuka tanpa internet selepas lawatan pertama (sebelum ini boleh tersekat di skrin pembuka)'],
    },
  },
  {
    version: '1.3.0',
    released: '2026-10-30T14:36:04Z',
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
    released: '2026-10-30T13:29:59Z',
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
    released: '2026-10-30T13:19:20Z',
    notes: {
      en: ['Redesigned bottom tab bar with evenly spaced tabs', '"Me" is now "Settings"', 'Share AnyScan with friends using a QR code or link'],
      zh: ['重新设计底部导航栏，按钮间距平均', '"我的"改为"设置"', '可用二维码或链接把 AnyScan 分享给朋友'],
      ms: ['Bar tab bawah direka semula dengan jarak sekata', '"Saya" kini "Tetapan"', 'Kongsi AnyScan dengan rakan melalui kod QR atau pautan'],
    },
  },
  {
    version: '1.0.0',
    released: '2026-10-30T12:53:01Z',
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

/** When a release went out, in the phone's own time zone and date format. */
export function releaseTime(r: Release, lang: Lang): string {
  const d = new Date(r.released ?? __BUILD_TIME__)
  const locale = lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-GB'
  return d.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

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
