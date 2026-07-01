# Workflow Capabilities

Bu sənəd hər workflow-un hansı capability, evidence və human-gate siyasəti ilə işlədiyini göstərir.

## quick

- capabilities: code, edit, validation-lite
- recommended model class: fast_coder
- evidence: static_contract
- human gate: minimal

## default

- capabilities: code, edit, review, validation
- recommended model class: balanced_coder
- evidence: static_contract, unit_or_integration
- human gate: normal

## gui

- capabilities: browser, visual_observation, checkpoint
- recommended model class: vision_reasoner
- evidence: live_smoke
- human gate: strict_for_sensitive_actions

## seo_gui

- capabilities: browser, visual_observation, seo_audit, checkpoint, review
- recommended model class: vision_reasoner_plus_strategy
- evidence: live_smoke, manual_oracle
- human gate: strict_for_save_publish

## thorough

- capabilities: architecture, code, security, qa
- recommended model class: frontier_reasoner
- evidence: static_contract, unit_or_integration, frontend_build
- human gate: normal

## review-only

- capabilities: audit, security_review, reporting
- recommended model class: reasoner
- evidence: static_contract
- human gate: none
