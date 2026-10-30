import { useState } from 'react'
import { Icon } from './Icon'
import { LANGS, makeT, type Lang } from '../i18n'
import { useApp } from '../state'

const SAMPLE: Record<Lang, string> = {
  en: 'Scan anything. Free forever.',
  zh: '扫描一切，永久免费',
  ms: 'Imbas apa sahaja. Percuma selamanya.',
}

/** First-launch screen: the user picks the app language (English is preselected). */
export function LanguagePicker() {
  const { setSettings } = useApp()
  const [lang, setLang] = useState<Lang>('en')
  const t = makeT(lang)
  return (
    <div className="lang-pick" role="dialog" aria-modal="true" aria-labelledby="lang-pick-title">
      <div className="lang-pick-head">
        <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} width={72} height={72} alt="" />
        {/* Shown in all three languages because nothing has been chosen yet. */}
        <h1 id="lang-pick-title">Choose your language</h1>
        <p>选择语言 · Pilih bahasa</p>
      </div>
      <div className="lang-pick-list" role="radiogroup">
        {LANGS.map((l) => (
          <button key={l.code} role="radio" aria-checked={lang === l.code} className={`lang-option ${lang === l.code ? 'on' : ''}`} onClick={() => setLang(l.code)}>
            <span className="lang-option-text">
              <strong>{l.name}</strong>
              <span>{SAMPLE[l.code]}</span>
            </span>
            <span className="lang-radio">{lang === l.code && <Icon name="check" size={16} stroke={3} />}</span>
          </button>
        ))}
      </div>
      <div className="lang-pick-foot">
        <button className="btn primary block" onClick={() => setSettings({ lang, langChosen: true })}>
          {t('continue')} <Icon name="chevron" size={18} />
        </button>
        <p>{t('changeLangLater')}</p>
      </div>
    </div>
  )
}
