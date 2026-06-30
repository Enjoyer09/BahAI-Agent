// ==========================================
// P3-FIX: i18n — Internationalization Base System
// Currently supports: az (Azərbaycan), en (English)
// Default: az (matching existing hardcoded strings)
// ==========================================

export type Locale = 'az' | 'en';

const translations: Record<Locale, Record<string, string>> = {
  az: {
    // Auth
    'auth.login': 'Daxil ol',
    'auth.register': 'Qeydiyyat',
    'auth.logout': 'Çıxış',
    'auth.email': 'E-poçt',
    'auth.password': 'Şifrə',
    'auth.fullName': 'Ad və Soyad',
    'auth.loginWithGoogle': 'Google ilə daxil ol',
    'auth.tooManyAttempts': 'Çox cəhd olundu. 15 dəqiqə sonra yenidən cəhd edin.',
    'auth.sessionExpired': 'Sessiya vaxtı bitib. Yenidən daxil olun.',
    'auth.invalidCredentials': 'E-poçt və ya şifrə yanlışdır',

    // Chat
    'chat.placeholder': 'Mesajınızı yazın...',
    'chat.send': 'Göndər',
    'chat.stop': 'Dayandır',
    'chat.newChat': 'Yeni söhbət',
    'chat.safeMode': 'Təhlükəsiz rejim',
    'chat.loading': 'Yüklənir...',

    // Sidebar
    'sidebar.projects': 'Layihələr',
    'sidebar.conversations': 'Söhbətlər',
    'sidebar.settings': 'Parametrlər',
    'sidebar.noProjects': 'Hələ layihə yoxdur',

    // Tools
    'tool.running': 'İcra olunur...',
    'tool.completed': 'Tamamlandı',
    'tool.error': 'Xəta',

    // Errors
    'error.generic': 'Bir xəta baş verdi',
    'error.network': 'Şəbəkə xətası',
    'error.retry': 'Yenidən cəhd et',
    'error.serverDown': 'Server cavab vermir',

    // Approvals
    'approval.approve': 'Təsdiqlə',
    'approval.reject': 'Rədd et',
    'approval.pending': 'Təsdiq gözləyir',

    // General
    'general.cancel': 'Ləğv et',
    'general.save': 'Saxla',
    'general.delete': 'Sil',
    'general.close': 'Bağla',
    'general.search': 'Axtar',
    'general.noResults': 'Nəticə tapılmadı',
  },

  en: {
    // Auth
    'auth.login': 'Sign In',
    'auth.register': 'Register',
    'auth.logout': 'Sign Out',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.fullName': 'Full Name',
    'auth.loginWithGoogle': 'Sign in with Google',
    'auth.tooManyAttempts': 'Too many attempts. Try again in 15 minutes.',
    'auth.sessionExpired': 'Session expired. Please sign in again.',
    'auth.invalidCredentials': 'Invalid email or password',

    // Chat
    'chat.placeholder': 'Type your message...',
    'chat.send': 'Send',
    'chat.stop': 'Stop',
    'chat.newChat': 'New Chat',
    'chat.safeMode': 'Safe Mode',
    'chat.loading': 'Loading...',

    // Sidebar
    'sidebar.projects': 'Projects',
    'sidebar.conversations': 'Conversations',
    'sidebar.settings': 'Settings',
    'sidebar.noProjects': 'No projects yet',

    // Tools
    'tool.running': 'Running...',
    'tool.completed': 'Completed',
    'tool.error': 'Error',

    // Errors
    'error.generic': 'An error occurred',
    'error.network': 'Network error',
    'error.retry': 'Retry',
    'error.serverDown': 'Server not responding',

    // Approvals
    'approval.approve': 'Approve',
    'approval.reject': 'Reject',
    'approval.pending': 'Pending approval',

    // General
    'general.cancel': 'Cancel',
    'general.save': 'Save',
    'general.delete': 'Delete',
    'general.close': 'Close',
    'general.search': 'Search',
    'general.noResults': 'No results found',
  }
};

// Get saved locale or detect from browser
function getDefaultLocale(): Locale {
  try {
    const saved = localStorage.getItem('locale');
    if (saved === 'az' || saved === 'en') return saved;
  } catch {}
  
  // Detect from browser language
  const browserLang = navigator.language?.toLowerCase() || '';
  if (browserLang.startsWith('az')) return 'az';
  if (browserLang.startsWith('en')) return 'en';
  return 'az'; // Default to Azerbaijani
}

let currentLocale: Locale = getDefaultLocale();

export function setLocale(locale: Locale) {
  currentLocale = locale;
  try { localStorage.setItem('locale', locale); } catch {}
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Translate a key to the current locale.
 * Falls back to 'az' if key not found in current locale.
 * Falls back to key itself if not found anywhere.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let text = translations[currentLocale]?.[key] 
    || translations['az']?.[key] 
    || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }

  return text;
}

export default { t, setLocale, getLocale };
