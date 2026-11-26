/** "2026-11-26" → "26/11/2026" (cách ghi ngày của người đọc Việt Nam). */
export const articleDate = (isoDate: string) => isoDate.split("-").reverse().join("/");
