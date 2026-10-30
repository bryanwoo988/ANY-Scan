import { Icon } from './components/Icon'
import { useApp, type Tab } from './state'
import { useTools } from './tools'
import { DocsTab, HomeTab, SettingsTab, ToolsTab } from './screens/Tabs'
import { ScanScreen } from './screens/Scan'
import { DocScreen, ExportScreen, MergeScreen, PageScreen, PagesScreen, PickImportScreen, PickScreen, PrintScreen } from './screens/Doc'
import { OcrScreen, SignScreen, TimestampScreen, WatermarkScreen } from './screens/Edit'
import { IdCardScreen, IdPhotoScreen } from './screens/Id'
import { QrCreateScreen, QrHubScreen, QrScanScreen } from './screens/Qr'
import type { ComponentType } from 'react'
import { HistoryScreen, UpdateBanner, useShowWhatsNewOnUpgrade, WhatsNewSheet } from './components/SettingsParts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ROUTES: Record<string, ComponentType<any>> = {
  scan: ScanScreen,
  doc: DocScreen,
  page: PageScreen,
  export: ExportScreen,
  pick: PickScreen,
  pickImport: PickImportScreen,
  merge: MergeScreen,
  pages: PagesScreen,
  print: PrintScreen,
  ocr: OcrScreen,
  sign: SignScreen,
  watermark: WatermarkScreen,
  timestamp: TimestampScreen,
  idcard: IdCardScreen,
  idphoto: IdPhotoScreen,
  qr: QrHubScreen,
  qrscan: QrScanScreen,
  qrcreate: QrCreateScreen,
  history: HistoryScreen,
}

const TABS: { id: Tab; icon: 'home' | 'docs' | 'grid' | 'settings' }[] = [
  { id: 'home', icon: 'home' },
  { id: 'docs', icon: 'docs' },
  { id: 'tools', icon: 'grid' },
  { id: 'settings', icon: 'settings' },
]

export default function App() {
  const { tab, setTab, stack, t } = useApp()
  const { run } = useTools()
  const [whatsNew, closeWhatsNew] = useShowWhatsNewOnUpgrade()
  const top = stack[stack.length - 1]
  const Top = top ? ROUTES[top.name] : null

  return (
    <div className="app">
      <div className="tabs-layer" hidden={!!top} aria-hidden={!!top}>
        <div className="tab-scroll">
          {tab === 'home' && <HomeTab />}
          {tab === 'docs' && <DocsTab />}
          {tab === 'tools' && <ToolsTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
        <UpdateBanner />
        <nav className="tabbar">
          {TABS.slice(0, 2).map((x) => (
            <button key={x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
              <span className="tab-ico">
                <Icon name={x.icon} size={22} />
              </span>
              <span>{t(`tab.${x.id}`)}</span>
            </button>
          ))}
          <div className="fab-slot">
            <button className="fab" onClick={() => run('smartScan')} aria-label={t('tool.smartScan')}>
              <Icon name="camera" size={28} />
            </button>
          </div>
          {TABS.slice(2).map((x) => (
            <button key={x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
              <span className="tab-ico">
                <Icon name={x.icon} size={22} />
              </span>
              <span>{t(`tab.${x.id}`)}</span>
            </button>
          ))}
        </nav>
      </div>
      <WhatsNewSheet open={whatsNew} onClose={closeWhatsNew} />
      {top && Top && (
        <div className="route-layer" key={top.key}>
          <Top {...top.params} />
        </div>
      )}
    </div>
  )
}
