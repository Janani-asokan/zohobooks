/* The business day is Indian time: "today", invoice dates, overdue checks and the books all follow IST,
   whatever timezone the server machine runs in (Render runs in UTC). Imported first by the server. */
export const BUSINESS_TZ = process.env.BUSINESS_TZ || 'Asia/Kolkata';
process.env.TZ = BUSINESS_TZ;
