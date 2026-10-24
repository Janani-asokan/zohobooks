export type Lang = 'en' | 'hi' | 'ta';
export const LANGS: Array<{ id: Lang; label: string; native: string }> = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { id: 'ta', label: 'Tamil', native: 'தமிழ்' },
];

/**
 * UI translations. Navigation, shell, dashboards, common actions and the login page are translated;
 * longer help text falls back to English (key → English string).
 */
const dict = {
  // navigation
  'nav.home': { en: 'Home', hi: 'होम', ta: 'முகப்பு' },
  'nav.pos': { en: 'POS Billing', hi: 'पीओएस बिलिंग', ta: 'பிஓஎஸ் பில்லிங்' },
  'nav.items': { en: 'Items', hi: 'आइटम', ta: 'பொருட்கள்' },
  'nav.sales': { en: 'Sales', hi: 'बिक्री', ta: 'விற்பனை' },
  'nav.customers': { en: 'Customers', hi: 'ग्राहक', ta: 'வாடிக்கையாளர்கள்' },
  'nav.salesOrders': { en: 'Sales Orders', hi: 'बिक्री ऑर्डर', ta: 'விற்பனை ஆர்டர்கள்' },
  'nav.invoices': { en: 'Invoices', hi: 'इनवॉइस', ta: 'விலைப்பட்டியல்கள்' },
  'nav.payments': { en: 'Payments Received', hi: 'प्राप्त भुगतान', ta: 'பெற்ற கட்டணங்கள்' },
  'nav.creditNotes': { en: 'Credit Notes', hi: 'क्रेडिट नोट', ta: 'கடன் குறிப்புகள்' },
  'nav.recurring': { en: 'Recurring Invoices', hi: 'आवर्ती इनवॉइस', ta: 'தொடர் விலைப்பட்டியல்கள்' },
  'nav.purchases': { en: 'Purchases', hi: 'खरीद', ta: 'கொள்முதல்' },
  'nav.vendors': { en: 'Vendors', hi: 'विक्रेता', ta: 'விற்பனையாளர்கள்' },
  'nav.purchaseOrders': { en: 'Purchase Orders', hi: 'खरीद ऑर्डर', ta: 'கொள்முதல் ஆர்டர்கள்' },
  'nav.bills': { en: 'Bills', hi: 'बिल', ta: 'பில்கள்' },
  'nav.expenses': { en: 'Expenses', hi: 'खर्च', ta: 'செலவுகள்' },
  'nav.secMain': { en: 'Overview', hi: 'अवलोकन', ta: 'கண்ணோட்டம்' },
  'nav.secBusiness': { en: 'Business', hi: 'व्यापार', ta: 'வணிகம்' },
  'nav.secAccounts': { en: 'Accounts', hi: 'खाते', ta: 'கணக்குகள்' },
  'nav.banking': { en: 'Banking', hi: 'बैंकिंग', ta: 'வங்கி' },
  'nav.reports': { en: 'Reports', hi: 'रिपोर्ट', ta: 'அறிக்கைகள்' },
  'nav.dashboard': { en: 'Dashboard', hi: 'डैशबोर्ड', ta: 'டாஷ்போர்டு' },
  'nav.configuration': { en: 'Configuration', hi: 'कॉन्फ़िगरेशन', ta: 'கட்டமைப்பு' },
  'nav.collapse': { en: 'Collapse', hi: 'छोटा करें', ta: 'சுருக்கு' },
  // shell
  'shell.search': { en: 'Search items, customers, invoices…', hi: 'आइटम, ग्राहक, इनवॉइस खोजें…', ta: 'பொருட்கள், வாடிக்கையாளர்கள், விலைப்பட்டியல்களைத் தேடு…' },
  'shell.newInvoice': { en: 'New Invoice', hi: 'नया इनवॉइस', ta: 'புதிய விலைப்பட்டியல்' },
  'shell.daysLeft': { en: 'd left', hi: ' दिन शेष', ta: ' நாள் உள்ளது' },
  'shell.orgProfile': { en: 'Organization profile', hi: 'संगठन प्रोफ़ाइल', ta: 'நிறுவன விவரம்' },
  'shell.team': { en: 'Staff, roles & branches', hi: 'स्टाफ, भूमिकाएं और शाखाएं', ta: 'பணியாளர்கள், பாத்திரங்கள் & கிளைகள்' },
  'shell.billing': { en: 'Subscription & billing', hi: 'सदस्यता और बिलिंग', ta: 'சந்தா & கட்டணம்' },
  'shell.preferences': { en: 'Preferences', hi: 'प्राथमिकताएं', ta: 'விருப்பங்கள்' },
  'shell.signOut': { en: 'Sign out', hi: 'साइन आउट', ta: 'வெளியேறு' },
  'shell.notifications': { en: 'Notifications', hi: 'सूचनाएं', ta: 'அறிவிப்புகள்' },
  'shell.noNotifications': { en: 'You’re all caught up', hi: 'कोई नई सूचना नहीं', ta: 'புதிய அறிவிப்புகள் இல்லை' },
  'shell.offline': { en: 'You’re offline — showing saved data. Changes are disabled until you reconnect.', hi: 'आप ऑफ़लाइन हैं — सहेजा गया डेटा दिख रहा है। दोबारा जुड़ने तक बदलाव बंद हैं।', ta: 'இணைப்பு இல்லை — சேமித்த தரவு காட்டப்படுகிறது. மீண்டும் இணையும் வரை மாற்றங்கள் முடக்கப்பட்டுள்ளன.' },
  'shell.theme': { en: 'Theme', hi: 'थीम', ta: 'தீம்' },
  'shell.language': { en: 'Language', hi: 'भाषा', ta: 'மொழி' },
  'shell.shortcuts': { en: 'Keyboard shortcuts', hi: 'कीबोर्ड शॉर्टकट', ta: 'விசைப்பலகை குறுக்குவழிகள்' },
  'theme.light': { en: 'Light', hi: 'लाइट', ta: 'ஒளி' },
  'theme.dark': { en: 'Dark', hi: 'डार्क', ta: 'இருள்' },
  'theme.system': { en: 'System', hi: 'सिस्टम', ta: 'கணினி' },
  // common
  'common.save': { en: 'Save', hi: 'सहेजें', ta: 'சேமி' },
  'common.saveChanges': { en: 'Save Changes', hi: 'बदलाव सहेजें', ta: 'மாற்றங்களைச் சேமி' },
  'common.cancel': { en: 'Cancel', hi: 'रद्द करें', ta: 'ரத்து' },
  'common.delete': { en: 'Delete', hi: 'हटाएं', ta: 'நீக்கு' },
  'common.edit': { en: 'Edit', hi: 'संपादित करें', ta: 'திருத்து' },
  'common.search': { en: 'Search', hi: 'खोजें', ta: 'தேடு' },
  'common.export': { en: 'Export', hi: 'निर्यात', ta: 'ஏற்றுமதி' },
  'common.import': { en: 'Import', hi: 'आयात', ta: 'இறக்குமதி' },
  'common.print': { en: 'Print', hi: 'प्रिंट', ta: 'அச்சிடு' },
  'common.all': { en: 'All', hi: 'सभी', ta: 'அனைத்தும்' },
  'common.loading': { en: 'Loading…', hi: 'लोड हो रहा है…', ta: 'ஏற்றுகிறது…' },
  'common.amount': { en: 'Amount', hi: 'राशि', ta: 'தொகை' },
  'common.date': { en: 'Date', hi: 'तारीख', ta: 'தேதி' },
  'common.status': { en: 'Status', hi: 'स्थिति', ta: 'நிலை' },
  'common.customer': { en: 'Customer', hi: 'ग्राहक', ta: 'வாடிக்கையாளர்' },
  'common.total': { en: 'Total', hi: 'कुल', ta: 'மொத்தம்' },
  'common.retry': { en: 'Try again', hi: 'फिर से कोशिश करें', ta: 'மீண்டும் முயற்சி' },
  // status
  'status.Paid': { en: 'Paid', hi: 'भुगतान हुआ', ta: 'செலுத்தப்பட்டது' },
  'status.Unpaid': { en: 'Unpaid', hi: 'अवैतनिक', ta: 'செலுத்தப்படவில்லை' },
  'status.Overdue': { en: 'Overdue', hi: 'बकाया', ta: 'தாமதம்' },
  'status.Partially Paid': { en: 'Partially Paid', hi: 'आंशिक भुगतान', ta: 'பகுதி செலுத்தப்பட்டது' },
  'status.Draft': { en: 'Draft', hi: 'ड्राफ्ट', ta: 'வரைவு' },
  'status.Cancelled': { en: 'Cancelled', hi: 'रद्द', ta: 'ரத்து செய்யப்பட்டது' },
  'status.Sent': { en: 'Sent', hi: 'भेजा गया', ta: 'அனுப்பப்பட்டது' },
  'status.Void': { en: 'Void', hi: 'शून्य', ta: 'செல்லாது' },
  // dashboard
  'home.goodMorning': { en: 'Good morning', hi: 'सुप्रभात', ta: 'காலை வணக்கம்' },
  'home.goodAfternoon': { en: 'Good afternoon', hi: 'नमस्कार', ta: 'மதிய வணக்கம்' },
  'home.goodEvening': { en: 'Good evening', hi: 'शुभ संध्या', ta: 'மாலை வணக்கம்' },
  'home.receivables': { en: 'Total Receivables', hi: 'कुल प्राप्य', ta: 'மொத்த வரவேண்டியவை' },
  'home.overdue': { en: 'Overdue', hi: 'बकाया', ta: 'தாமதமானவை' },
  'home.sales': { en: 'Sales', hi: 'बिक्री', ta: 'விற்பனை' },
  'home.today': { en: 'Today’s sales', hi: 'आज की बिक्री', ta: 'இன்றைய விற்பனை' },
  'home.lowStock': { en: 'Low Stock Items', hi: 'कम स्टॉक आइटम', ta: 'குறைந்த இருப்பு' },
  'home.salesCollections': { en: 'Sales & collections', hi: 'बिक्री और वसूली', ta: 'விற்பனை & வசூல்' },
  'home.topItems': { en: 'Top selling items', hi: 'सबसे ज़्यादा बिकने वाले', ta: 'அதிகம் விற்பனையானவை' },
  'home.recent': { en: 'Recent invoices', hi: 'हाल के इनवॉइस', ta: 'சமீபத்திய விலைப்பட்டியல்கள்' },
  'home.viewAll': { en: 'View all', hi: 'सभी देखें', ta: 'அனைத்தையும் காண்க' },
  'home.addCustomer': { en: 'Add Customer', hi: 'ग्राहक जोड़ें', ta: 'வாடிக்கையாளரைச் சேர்' },
  'home.addItem': { en: 'Add Item', hi: 'आइटम जोड़ें', ta: 'பொருளைச் சேர்' },
  'home.invoiced': { en: 'Invoiced', hi: 'इनवॉइस किया', ta: 'பட்டியலிடப்பட்டது' },
  'home.collected': { en: 'Collected', hi: 'वसूला गया', ta: 'வசூலிக்கப்பட்டது' },
  // login
  'login.title': { en: 'Sign in to Corpus360', hi: 'अपने खाते में साइन इन करें', ta: 'உங்கள் கணக்கில் உள்நுழையவும்' },
  'login.lead': { en: 'Use the email your business invited you with.', hi: 'एक सुरक्षित वर्कस्पेस से इनवॉइस, इन्वेंट्री और जीएसटी अनुपालन संभालें।', ta: 'ஒரே பாதுகாப்பான இடத்தில் விலைப்பட்டியல், இருப்பு மற்றும் ஜிஎஸ்டி இணக்கத்தை நிர்வகிக்கவும்.' },
  'login.email': { en: 'Email address', hi: 'ईमेल पता', ta: 'மின்னஞ்சல் முகவரி' },
  'login.password': { en: 'Password', hi: 'पासवर्ड', ta: 'கடவுச்சொல்' },
  'login.remember': { en: 'Keep me signed in', hi: 'मुझे साइन इन रखें', ta: 'உள்நுழைந்தே இருக்கவும்' },
  'login.forgot': { en: 'Forgot password?', hi: 'पासवर्ड भूल गए?', ta: 'கடவுச்சொல் மறந்ததா?' },
  'login.submit': { en: 'Sign in', hi: 'साइन इन करें', ta: 'உள்நுழை' },
  'login.signingIn': { en: 'Signing in…', hi: 'साइन इन हो रहा है…', ta: 'உள்நுழைகிறது…' },
} satisfies Record<string, Record<Lang, string>>;

export type TKey = keyof typeof dict;

export const translate = (lang: Lang, key: TKey | string, fallback?: string) => {
  const e = (dict as Record<string, Record<Lang, string>>)[key];
  return e?.[lang] ?? e?.en ?? fallback ?? key;
};
