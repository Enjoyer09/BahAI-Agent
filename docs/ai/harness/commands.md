# Commands And Workflow Contracts

## Workflow məqsədi

BahAI-də workflow seçimi token intizamı, agent seçimi və yoxlama dərinliyini müəyyən edir.

Hazır workflow-lar:

- `quick`
  - manager_direct / solo icra üçün uyğundur
  - kiçik dəyişiklik, qısa cavab, aşağı koordinasiya xərci
- `default`
  - planner-first selective dispatch
  - normal coding və audit işi üçün əsas seçim
- `gui`
  - browser / GUI observation, action, checkpoint və resume axını
  - visible browser və human checkpoint davranışı burada prioritetdir
- `seo_gui`
  - SEO strategist + GUI operator hibrid axını
  - platform SEO settings, dashboard navigation, safe observe/report workflow
- `thorough`
  - daha dərin planning + review + validation
- `review-only`
  - findings-first review, dəyişiklik etmədən risk çıxarmaq

## Manager contract

Manager aşağıdakı öhdəliklərə malikdir:

- hər sorğuya bütün agentləri qoşmamaq
- sualın növünə görə minimum lazımi agent seçmək
- GUI sorğularını audit/default kimi yanlış route etməmək
- checkpoint və queue vəziyyətlərini istifadəçiyə aydın göstərmək

## GUI contract

GUI workflow üçün minimum contract:

- browser open nəticəsi tool artifact kimi görünməlidir
- observation screenshot və ya title/url metadata qaytarmalıdır
- login checkpoint varsa run açıq qalıb STOP vəziyyətində ilişməməlidir
- `login oldum` resume ayrıca SSE axını ilə davam etməlidir
- yüksək riskli action-lar üçün human gate saxlanmalıdır

## SEO GUI contract

`seo_gui` workflow üçün minimum contract:

- SEO specialist əvvəlcə findings/opportunities və safe next step məntiqi qurmalıdır
- GUI operator yalnız observe/safe navigate etməlidir
- publish/save/delete/billing action-ları human approval olmadan edilməməlidir
- Wix/oxşar dashboard-da SEO settings tapılmasa, bunu failure yox, observation gap kimi report etməlidir

## Review contract

Reviewer aşağıdakı qaydaları izləyir:

- findings-first
- severity order
- file/path əsaslı konkret müşahidə
- test gap və residual risk ayrıca qeyd olunmalıdır

## Validation contract

Validation mümkün olduqca riskə proporsional olmalıdır:

- kiçik UI dəyişiklik -> build və ya targeted smoke
- orchestration dəyişiklik -> unit/integration və ya transcript replay
- GUI/browser dəyişiklik -> live smoke və artifact
- deployment dəyişiklik -> prod smoke və endpoint check
