# Requirements Document

## Introduction

Bu sənəd BahAI Desktop App Builder xüsusiyyətinin tələblərini müəyyənləşdirir. Desktop versiyası tam IDE-tipli AI-powered tətbiq yaradıcısı olacaq — istifadəçi təbii dildə "mənə pizza sifariş saytı yarat" deyəndə agent planlaşdırır, kod yazır, faylları yaradır, serveri işə salır və canlı preview göstərir. Sistem Cursor/Windsurf/Bolt-a bənzər, lakin Azərbaycan bazarı üçün optimallaşdırılmış olacaq.

## Glossary

- **App_Builder**: Desktop tətbiqinin əsas iş rejimi — istifadəçinin təbii dildə verdigi göstərişə əsasən tam tətbiq yaradan sistem
- **Workspace**: İstifadəçinin layihə üzərində işlədiyi qovluq və onun bütün faylları
- **File_Tree**: Workspace-dəki faylları ağac strukturunda göstərən sol panel komponenti
- **Code_Editor**: Monaco-əsaslı daxili kod redaktoru — syntax highlighting, auto-complete dəstəkli
- **Terminal_Panel**: İnteqrasiya edilmiş terminal emulatoru — əmrləri birbaşa icra edən
- **Live_Preview**: Yaradılmış tətbiqin real-time iframe/webview-da göstərilməsi
- **Orchestrator**: Planner → Builder → Reviewer axınını idarə edən çox-agentli sistem
- **Planner_Agent**: İstifadəçi tapşırığını analiz edib addım-addım plan yaradan agent
- **Builder_Agent**: Planı icra edərək kod yazan, faylları yaradan, əmrləri işlədən agent
- **Reviewer_Agent**: Builder çıxışını yoxlayan, səhvləri tapan, keyfiyyəti təmin edən agent
- **OmniRoute**: Ağıllı model routinq sistemi — uyğun AI modelini avtomatik seçən
- **Deploy_Pipeline**: Yaradılmış layihəni Railway/Vercel/Netlify-ə avtomatik deploy edən sistem
- **Project_Scaffold**: Yeni layihə üçün əsas fayl strukturunu (package.json, index.html, və s.) yaradan proses
- **Safe_Mode**: Agent əməliyyatlarından əvvəl istifadəçi təsdiqini tələb edən təhlükəsizlik rejimi

## Requirements

### Requirement 1: Təbii Dildən Tətbiq Yaratma

**User Story:** İstifadəçi olaraq, mən təbii dildə yazmaqla tam işləyən tətbiq yaratmaq istəyirəm ki, proqramlaşdırma bilmədən öz fikrimi həyata keçirə bilim.

#### Acceptance Criteria

1. WHEN istifadəçi təbii dildə tətbiq təsviri göndərdikdə, THE Planner_Agent SHALL təsviri analiz edib strukturlaşdırılmış plan yaratmalıdır (texnologiya seçimi, fayl strukturu, komponentlər siyahısı)
2. WHEN plan hazır olduqda, THE Builder_Agent SHALL planı addım-addım icra edərək lazımi faylları yaratmalıdır
3. WHEN Builder_Agent faylları yaratdıqdan sonra, THE Reviewer_Agent SHALL yaradılan kodu yoxlayıb səhvləri düzəltməlidir
4. WHEN bütün fayllar yaradıldıqda, THE App_Builder SHALL avtomatik olaraq asılılıqları quraşdırmalı və development serveri işə salmalıdır
5. IF Planner_Agent istifadəçi təsvirini başa düşmədikdə, THEN THE App_Builder SHALL aydınlaşdırıcı sual verməlidir

### Requirement 2: İnteqrasiya Edilmiş İş Mühiti (IDE Layout)

**User Story:** İstifadəçi olaraq, mən bir pəncərədə fayl ağacı, kod redaktoru, terminal və canlı preview-u görmək istəyirəm ki, iş axınım kəsilmədən davam etsin.

#### Acceptance Criteria

1. THE App_Builder SHALL ekranı dörd əsas panelə bölməlidir: File_Tree (sol), Code_Editor (mərkəz), Terminal_Panel (alt), Live_Preview (sağ)
2. WHEN istifadəçi File_Tree-dən fayl seçdikdə, THE Code_Editor SHALL həmin faylı syntax highlighting ilə açmalıdır
3. WHEN agent fayl yaratdıqda və ya redaktə etdikdə, THE File_Tree SHALL avtomatik yenilənməlidir
4. THE Terminal_Panel SHALL istifadəçinin əl ilə əmr daxil etməsini və nəticəni görməsini təmin etməlidir
5. WHEN development server aktiv olduqda, THE Live_Preview SHALL tətbiqin canlı görüntüsünü iframe vasitəsilə göstərməlidir
6. THE App_Builder SHALL panel ölçülərini istifadəçinin sürüşdürməsi ilə dəyişməyə imkan verməlidir (resizable panels)
7. WHILE istifadəçi mobil cihazda olduqda, THE App_Builder SHALL panelləri tab-əsaslı navigasiya ilə göstərməlidir

### Requirement 3: Real-Time Fayl Sistemi Sinxronizasiyası

**User Story:** İstifadəçi olaraq, mən agentin yaratdığı və redaktə etdiyi faylları real-time görmək istəyirəm ki, prosesin hər addımını izləyə bilim.

#### Acceptance Criteria

1. WHEN Builder_Agent write_file alətini istifadə etdikdə, THE File_Tree SHALL 500ms daxilində yeni faylı göstərməlidir
2. WHEN Builder_Agent file_edit alətini istifadə etdikdə, THE Code_Editor SHALL açıq faylda dəyişikliyi real-time əks etdirməlidir
3. WHEN istifadəçi Code_Editor-da faylı əl ilə dəyişdirdikdə, THE App_Builder SHALL dəyişikliyi disk-ə yazmalıdır
4. THE App_Builder SHALL fayl sistemi dəyişikliklərini izləmək üçün file watcher istifadə etməlidir
5. IF Code_Editor-da açıq fayl xaricdən dəyişdirildikdə, THEN THE Code_Editor SHALL istifadəçiyə bildiriş göstərib faylı yeniləməlidir

### Requirement 4: Git İnteqrasiyası

**User Story:** İstifadəçi olaraq, mən layihəmi GitHub-a push etmək, commit yaratmaq və branch-larla işləmək istəyirəm ki, versiya idarəetməsini rahat edə bilim.

#### Acceptance Criteria

1. WHEN istifadəçi "GitHub-a push et" əmrini verdikdə, THE App_Builder SHALL dəyişiklikləri commit edib remote repository-yə push etməlidir
2. WHEN yeni layihə yaradıldıqda, THE App_Builder SHALL avtomatik git init əmrini icra edib .gitignore faylı yaratmalıdır
3. THE App_Builder SHALL Git status-u vizual olaraq File_Tree-də göstərməlidir (dəyişdirilmiş fayllar rənglə fərqləndirilir)
4. WHEN istifadəçi "repo klonla" əmri verdikdə, THE App_Builder SHALL verilmiş URL-dən repository klonlayıb Workspace-ə yükləməlidir
5. IF git push zamanı autentifikasiya tələb olunduqda, THEN THE App_Builder SHALL GitHub OAuth axını başlatmalıdır
6. THE App_Builder SHALL commit tarixçəsini vizual timeline şəklində göstərməlidir

### Requirement 5: Deploy Pipeline

**User Story:** İstifadəçi olaraq, mən yaradılan tətbiqimi bir kliklə internetdə yayımlamaq istəyirəm ki, başqaları ilə paylaşa bilim.

#### Acceptance Criteria

1. WHEN istifadəçi "deploy et" əmrini verdikdə, THE Deploy_Pipeline SHALL layihə tipinə uyğun hosting platforması təklif etməlidir (Railway, Vercel, Netlify)
2. WHEN platform seçildikdə, THE Deploy_Pipeline SHALL lazımi konfiqurasiya fayllarını yaratmalıdır (Dockerfile, vercel.json, netlify.toml)
3. WHEN deploy prosesi başladıqda, THE App_Builder SHALL prosesin statusunu real-time göstərməlidir (building, deploying, live)
4. WHEN deploy uğurlu olduqda, THE App_Builder SHALL tətbiqin canlı URL-ini istifadəçiyə göstərməlidir
5. IF deploy prosesi uğursuz olduqda, THEN THE Deploy_Pipeline SHALL xəta mesajını göstərib həll yolunu təklif etməlidir

### Requirement 6: Çox-Agentli Orkestrasiya

**User Story:** İstifadəçi olaraq, mən agentin planlaşdırma, icra və yoxlama mərhələlərini ayrıca görmək istəyirəm ki, prosesin keyfiyyətinə əmin olum.

#### Acceptance Criteria

1. THE Orchestrator SHALL hər tapşırığı üç mərhələdən keçirməlidir: Planner_Agent → Builder_Agent → Reviewer_Agent
2. WHEN Planner_Agent plan yaratdıqda, THE App_Builder SHALL planı istifadəçiyə göstərib təsdiq istəməlidir
3. WHILE Builder_Agent icra edərkən, THE App_Builder SHALL hər addımın statusunu (gözləyir, icra olunur, tamamlandı, xəta) göstərməlidir
4. WHEN Reviewer_Agent problem tapdıqda, THE Orchestrator SHALL Builder_Agent-ə düzəliş tapşırığı qaytarmalıdır
5. IF agent 3 dəfə ardıcıl eyni xətanı düzəldə bilmədikdə, THEN THE Orchestrator SHALL istifadəçidən kömək istəməlidir
6. WHILE Safe_Mode aktiv olduqda, THE Orchestrator SHALL hər fayl yazma və terminal əmrindən əvvəl istifadəçi təsdiqini gözləməlidir

### Requirement 7: Lokal Model Dəstəyi və Cloud Fallback

**User Story:** İstifadəçi olaraq, mən offline işləyə bilmək üçün lokal AI modellərindən istifadə etmək, lakin lazım olanda cloud modellərinə keçmək istəyirəm.

#### Acceptance Criteria

1. THE App_Builder SHALL Ollama vasitəsilə lokal modelləri (Gemma, Qwen, Llama) dəstəkləməlidir
2. WHEN lokal model cavab verə bilmədikdə, THE OmniRoute SHALL avtomatik olaraq cloud modellərə (FreeModel, OpenRouter, Puter AI) keçid etməlidir
3. THE App_Builder SHALL hər model keçidini istifadəçiyə bildirməlidir (hansı modeldən hansına keçdi)
4. WHEN istifadəçi internet bağlantısı olmadan işlədikdə, THE App_Builder SHALL yalnız lokal modellərdən istifadə etməlidir
5. THE App_Builder SHALL model seçimini parametrlər panelindən dəyişməyə imkan verməlidir

### Requirement 8: Project Scaffold və Template Sistemi

**User Story:** İstifadəçi olaraq, mən populyar framework-lar üçün hazır şablonlardan istifadə etmək istəyirəm ki, tətbiq yaratma prosesim sürətlənsin.

#### Acceptance Criteria

1. WHEN istifadəçi yeni layihə yaratmaq istədikdə, THE App_Builder SHALL mövcud şablonları təklif etməlidir (React, Next.js, Express, Flask, Static HTML)
2. WHEN şablon seçildikdə, THE Project_Scaffold SHALL şablona uyğun fayl strukturunu yaratmalıdır
3. THE Project_Scaffold SHALL hər şablon üçün müvafiq asılılıqları package.json və ya requirements.txt-ə əlavə etməlidir
4. WHEN istifadəçi heç bir şablon seçmədikdə, THE Planner_Agent SHALL tətbiq təsvirinə əsasən uyğun texnologiya stackini seçməlidir
5. THE App_Builder SHALL istifadəçinin öz şablonlarını yaratmasına və saxlamasına imkan verməlidir

### Requirement 9: Canlı Preview və Hot Reload

**User Story:** İstifadəçi olaraq, mən kodda hər dəyişikliyi dərhal preview-da görmək istəyirəm ki, nəticəni vizual olaraq qiymətləndirə bilim.

#### Acceptance Criteria

1. WHEN development server aktiv olduqda, THE Live_Preview SHALL tətbiqin görüntüsünü Electron webview və ya iframe vasitəsilə göstərməlidir
2. WHEN kod faylları dəyişdirildikdə, THE Live_Preview SHALL 2 saniyə daxilində yenilənməlidir (HMR və ya tam reload)
3. THE Live_Preview SHALL responsive rejim seçmə imkanı verməlidir (desktop, tablet, mobile görünüşlər)
4. WHEN Live_Preview-da JavaScript xətası baş verdikdə, THE App_Builder SHALL xətanı console overlay-da göstərməlidir
5. THE Live_Preview SHALL URL navigation bar-ı vasitəsilə tətbiq daxilində naviqasiya imkanı verməlidir

### Requirement 10: Təhlükəsizlik və Sandbox

**User Story:** İstifadəçi olaraq, mən agentin yalnız icazəli qovluqlarda işləməsini istəyirəm ki, sistemim təhlükəsiz qalsın.

#### Acceptance Criteria

1. THE App_Builder SHALL agent əməliyyatlarını yalnız icazəli qovluqlarla (ALLOWED_DIRECTORIES) məhdudlaşdırmalıdır
2. IF agent icazəsiz qovluğa müraciət etdikdə, THEN THE App_Builder SHALL əməliyyatı bloklayıb xəbərdarlıq göstərməlidir
3. THE App_Builder SHALL təhlükəli terminal əmrlərini (rm -rf /, format, shutdown) bloklamalıdır
4. WHILE Safe_Mode aktiv olduqda, THE App_Builder SHALL hər fayl sistemi əməliyyatından əvvəl istifadəçi təsdiqini tələb etməlidir
5. THE App_Builder SHALL agent sessiyalarını bir-birindən izolə etməlidir (fərqli layihələr bir-birinin fayllarına müdaxilə edə bilməz)
6. THE App_Builder SHALL icra edilmiş əmrlərin tarixçəsini audit log-da saxlamalıdır
