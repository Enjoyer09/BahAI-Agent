# Evidence Standard

BahAI-də dəyişiklik “bitdi” sayılmaq üçün mümkün olduqca uyğun evidence ilə bağlanmalıdır.

## Evidence növləri

- `static_contract`
  - syntax check
  - config check
  - script registration
- `unit_or_integration`
  - vitest və ya backend testləri
- `frontend_build`
  - Vite/TypeScript build
- `live_smoke`
  - GUI smoke
  - prod smoke
  - checkpoint smoke
- `manual_oracle`
  - yalnız insan login, captcha, publish-sensitive addımlarında

## Mapping

### Orchestration dəyişiklikləri

Tələb olunan minimum:

- `static_contract`
- `unit_or_integration`

Tövsiyə olunan:

- `live_smoke` əgər queue/checkpoint/UI davranışı dəyişibsə

### GUI/browser dəyişiklikləri

Tələb olunan minimum:

- `static_contract`
- `live_smoke`

Tövsiyə olunan:

- screenshot artifact
- failure diagnostics

### Frontend UI/mobile dəyişiklikləri

Tələb olunan minimum:

- `frontend_build`

Tövsiyə olunan:

- mobile screenshot
- interaction smoke

### Deployment/prod dəyişiklikləri

Tələb olunan minimum:

- endpoint health check
- `live_smoke`

## Failure policy

Əgər tələb olunan evidence alınmayıbsa, nəticə bunu açıq deməlidir:

- nə yoxlanıb
- nə yoxlanmayıb
- qalan risk nədir
