import nodemailer from 'nodemailer';
import { config } from './config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  cc?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

let transport: nodemailer.Transporter | null = null;
const outbox: Mail[] = []; // kept for tests / dev inspection when SMTP isn't configured

/** Sends via SMTP when configured; otherwise logs and stores in an in-memory outbox. Returns whether it was really sent. */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!config.smtp) {
    outbox.push(mail);
    if (outbox.length > 200) outbox.shift();
    const files = mail.attachments?.map((a) => `${a.filename} (${Math.round(a.content.length / 1024)} KB)`).join(', ');
    if (config.env !== 'test') console.log(`[mail:dev] to=${mail.to} subject="${mail.subject}"${files ? ` attachments=${files}` : ''}\n${mail.text}\n`);
    return false;
  }
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await transport.sendMail({ from: config.smtp.from, ...mail });
  return true;
}

export const devOutbox = () => outbox;
