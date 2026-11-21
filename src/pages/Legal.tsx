import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/api/client';
import { BrandLogo } from '@/components/Logo';
import { useAuth } from '@/context/AuthContext';
import { SHOP_RESTORE_DAYS } from '../../shared/accountDeletion';

/**
 * Public pages the Play Store listing links to: privacy policy, terms and how to delete an account. They open without
 * signing in, on the website and in the app.
 */
const UPDATED = '21 November 2026';

function useContact() {
  return useQuery({ queryKey: ['public', 'contact'], queryFn: () => api.get<{ phone: string; email: string }>('/public/contact'), staleTime: 300_000, retry: false });
}

function ContactLine() {
  const c = useContact().data;
  if (!c?.email && !c?.phone) return <>through <strong>Help → Talk to us</strong> in the app or on the website</>;
  return (
    <>
      {c.email && <>by email at <a href={`mailto:${c.email}`}>{c.email}</a></>}
      {c.email && c.phone && ' or '}
      {c.phone && <>by phone on <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a></>}
    </>
  );
}

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  const { me } = useAuth();
  return (
    <div className="legal">
      <header className="legal-head">
        <Link to="/" aria-label="Corpus360 home" style={{ color: 'var(--brand-600)' }}><BrandLogo height={18} /></Link>
        <Link to={me ? '/app' : '/login'} className="btn btn-ghost btn-sm"><ArrowLeft size={15} /> {me ? 'Back to the app' : 'Sign in'}</Link>
      </header>
      <article className="legal-body">
        <h1>{title}</h1>
        <p className="muted small">Last updated {UPDATED}</p>
        {children}
        <nav className="legal-links small">
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/terms">Terms of use</Link>
          <Link to="/delete-account">Delete your account</Link>
        </nav>
      </article>
    </div>
  );
}

export function Privacy() {
  return (
    <LegalShell title="Privacy policy">
      <p>Corpus360 and its phone app CorpusLite help shops make GST bills and keep stock. This page explains what we keep, why, and the choices you have. We don’t show ads and we never sell your data.</p>

      <h2>What we keep</h2>
      <ul>
        <li><strong>Your account:</strong> your name, email, phone number and a scrambled (hashed) copy of your password. We never see your password itself.</li>
        <li><strong>Your shop’s records:</strong> shop details and GSTIN, customers and suppliers, items, stock, bills, payments and accounts that you and your staff enter.</li>
        <li><strong>Sign-in and safety records:</strong> when and from which device and IP address someone signed in, and who changed what (the audit trail), so a shop can see who did what and we can stop misuse.</li>
        <li><strong>Pictures and files you add:</strong> item pictures, your logo, bill photos and attachments, and files you import. Only the ones you choose to upload.</li>
        <li><strong>This phone’s app ID:</strong> a random ID the app makes for each phone so it can number bills in its own series, even offline. It is not your phone’s IMEI or advertising ID.</li>
        <li><strong>Support:</strong> call-back requests, chat messages and help-bot questions you send us.</li>
        <li><strong>Email records:</strong> when we emailed you, the subject, and whether it was delivered, so we can sort out problems like a code that never arrived. Not the email text. Kept for 2 years.</li>
      </ul>

      <h2>What the phone uses, and only when you ask</h2>
      <ul>
        <li><strong>Camera</strong> — to scan a barcode or IMEI. The picture stays on the phone; only the number read from it is used.</li>
        <li><strong>Nearby devices (Bluetooth)</strong> — to print on a receipt printer you paired. Nothing is sent to us.</li>
        <li><strong>Files and share</strong> — to save or share a bill PDF or an export you made, through Android’s own share screen.</li>
      </ul>
      <p>The app does not read your contacts, messages or location, and sees only the pictures and files you choose to add. On the website, the optional field-staff feature records the location of staff on duty, only while they have started their day, so their shop can see visits.</p>

      <h2>Why we use it</h2>
      <p>Only to run the service for your shop: making and sending bills, keeping stock, GST reports, sign-in and security, sending the emails you expect (password reset, receipts, licence reminders) and answering support. We don’t use your shop’s records for advertising.</p>

      <h2>Who else handles it</h2>
      <ul>
        <li><strong>Our hosting provider</strong>, where the servers and database run.</li>
        <li><strong>Email delivery</strong> (Brevo or Resend) to send the emails above.</li>
        <li><strong>Razorpay</strong>, when you pay for a plan. Card and UPI details go straight to Razorpay; we never see them.</li>
        <li><strong>Anthropic (Claude)</strong>, only when someone uses an AI feature, such as the assistant or reading a supplier bill from a photo. The text or picture you give it is sent to answer that request and isn’t used to train their models.</li>
      </ul>
      <p>We share data with government or police only when the law requires it.</p>

      <h2>How we protect it</h2>
      <p>All traffic is encrypted (HTTPS). Passwords are hashed. Each shop’s records are kept apart in the database so one shop can never see another’s. Accounts lock after repeated wrong passwords. The app keeps your sign-in only on that phone and is excluded from phone backups.</p>

      <h2>How long we keep it</h2>
      <p>While your account is open. When an owner closes a shop, it can be restored for {SHOP_RESTORE_DAYS} days; after that the names, emails and passwords of its logins are erased. Bills and accounts are kept for as long as Indian GST law requires (72 months from the due date of the year’s annual return) and then deleted. See <Link to="/delete-account">Delete your account</Link>.</p>

      <h2>Your choices</h2>
      <p>You can see and correct your details in the app, download your shop’s records (Settings → Data import/export on the website), and delete your account at any time. To ask what we hold about you, or to complain, contact us <ContactLine />. We reply within 7 working days.</p>

      <h2>Children</h2>
      <p>Corpus360 is a business tool for shop owners and their staff. It is not meant for children under 18.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we’ll tell shop owners by email or in the app before it takes effect.</p>
    </LegalShell>
  );
}

export function Terms() {
  return (
    <LegalShell title="Terms of use">
      <p>By creating a shop or signing in to Corpus360 or CorpusLite you agree to these terms.</p>
      <h2>Your account</h2>
      <p>Keep your password to yourself. The shop owner decides who on the team can sign in and what each person can do, and is responsible for what their staff do in the shop’s account.</p>
      <h2>Your records</h2>
      <p>The bills, customers, stock and accounts you enter belong to your shop. You are responsible for their correctness and for filing your own GST returns; Corpus360 helps you prepare them but is not a tax adviser.</p>
      <h2>Fair use</h2>
      <p>Don’t use the service for anything illegal, to send spam, or to try to reach another shop’s data or slow the service for others. We may suspend an account that does.</p>
      <h2>Plans and payment</h2>
      <p>Paid plans are billed in advance for the period shown when you pay. If a licence runs out, the owner can still sign in to renew and export their data.</p>
      <h2>Availability</h2>
      <p>We work to keep the service running and back up data every day, but we can’t promise it will never be interrupted. Bills made offline in the app are kept on the phone and sent when the internet is back.</p>
      <h2>Closing your account</h2>
      <p>You can close your account at any time. See <Link to="/delete-account">Delete your account</Link>.</p>
      <h2>Contact</h2>
      <p>Questions about these terms: contact us <ContactLine />.</p>
    </LegalShell>
  );
}

export function DeleteAccountHelp() {
  return (
    <LegalShell title="Delete your Corpus360 account">
      <p>This applies to the Corpus360 website and the CorpusLite app. You can delete your account yourself, in the app or on the website.</p>

      <h2>Steps</h2>
      <ol>
        <li>Sign in (in the CorpusLite app or at this website).</li>
        <li>Tap your name at the top right, then <strong>My account</strong>.</li>
        <li>Choose <strong>Delete my login</strong> (staff) or <strong>Close this shop</strong> (shop owner), enter your password and confirm.</li>
      </ol>
      <p>Can’t sign in? Contact us <ContactLine /> from the email address on the account and we’ll delete it for you.</p>

      <h2>What is deleted, and what is kept</h2>
      <ul>
        <li><strong>A staff login:</strong> your name, email and password are erased at once and you are signed out everywhere. Bills you made stay with the shop, as the shop’s records.</li>
        <li><strong>A whole shop:</strong> everyone is signed out at once. For {SHOP_RESTORE_DAYS} days the owner can ask us to restore it. After that, the names, emails, phone numbers and passwords of the shop’s logins and owner are erased.</li>
        <li><strong>Kept by law:</strong> bills, credit notes, payments and accounts are tax records. Indian GST law requires them to be kept for 72 months from the due date of the year’s annual return, so we keep them for that time, unseen by anyone, and then delete them.</li>
      </ul>
    </LegalShell>
  );
}
