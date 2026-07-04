# GUI Capabilities

Bu qat GUI/browser workflow-larında agentin real imkanlarını əvvəlcədən aşkarlayır.

## Məqsəd

- Railway və remote Linux mühitində olmayan desktop capability-ləri dürüst göstərmək
- `screen_*` fallback-lərinin səhvən işə düşməsinin qarşısını almaq
- UI-də operatora "ok / degraded / missing" vəziyyətini göstərmək

## API

- `GET /api/gui-capabilities`

Query parametrləri:

- `mode`
- `browserPath`
- `cdpUrl`

## Qayda

- Browser-first GUI tapşırıqlarda əvvəl `browser_*` və `gui_*`
- `screen_*` yalnız istifadəçi açıq desktop/screen automation istəyibsə
- `screenAgent.available === false` olduqda screen path reklam edilməməlidir

## Status sahələri

- `summary.status`: `ok | degraded | missing`
- `browser.playwrightInstalled`
- `browser.resolvedMode`
- `screenAgent.available`
- `warnings[]`
