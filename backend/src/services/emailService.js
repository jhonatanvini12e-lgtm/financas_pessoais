import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import budgetParams from '../config/budgetParams.js';

const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const SECURITY_EMAIL = process.env.SECURITY_EMAIL || process.env.SMTP_USER;

const LOGO_CID = 'financas-pessoais-logo';
const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets/logo-mark.png');

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Template usado por todos os e-mails do sistema: cartao escuro alinhado
// com a identidade visual do app (mesmo selo e mesmas cores de
// src/index.css no frontend), com o codigo (quando houver) em destaque.
// Clientes de e-mail que bloqueiam HTML caem no campo `text` normal.
function buildHtml({ title, body, code }) {
    return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0; padding:32px 16px; background:#eef1f6; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <table role="presentation" width="420" cellpadding="0" cellspacing="0" style="max-width:420px; background:#0f172a; border-radius:14px; overflow:hidden;">
          <tr>
            <td style="padding:26px 28px 22px; border-bottom:1px solid rgba(255,255,255,.09);">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:12px;"><img src="cid:${LOGO_CID}" width="32" height="32" alt="Financas Pessoais" style="display:block; border-radius:8px;" /></td>
                  <td style="font-size:15px; font-weight:700; color:#f8fafc;">Financas Pessoais</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 10px; font-size:17px; font-weight:700; color:#f8fafc;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 ${code ? '22' : '0'}px; font-size:13px; line-height:1.6; color:#94a3b8;">${escapeHtml(body)}</p>
              ${code ? `<div style="font-family:'Courier New',monospace; font-size:26px; font-weight:700; letter-spacing:.24em; color:#f8fafc; background:#141d32; border:1px solid rgba(255,255,255,.16); border-radius:10px; padding:16px; text-align:center;">${escapeHtml(code)}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 24px; border-top:1px solid rgba(255,255,255,.09); font-size:10.5px; color:#64748b; text-align:center;">
              Financas Pessoais &middot; e-mail automatico, nao responda
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// `text` e o corpo em texto puro (usado como fallback e, por padrao, tambem
// como paragrafo do HTML). `htmlBody` deixa o paragrafo do HTML mais limpo
// quando ha `code`, pra nao repetir o codigo em prosa logo acima do bloco
// em destaque -- o fallback em texto puro continua completo.
async function sendMail(subject, text, { to = SECURITY_EMAIL, code, htmlBody } = {}) {
    try {
        await transporter.sendMail({
            from: `"Financas Pessoais" <${process.env.SMTP_USER}>`,
            to,
            subject,
            text,
            html: buildHtml({ title: subject, body: htmlBody || text, code }),
            attachments: [{ filename: 'logo.png', path: LOGO_PATH, cid: LOGO_CID }],
        });
        console.log(`Email enviado para ${to}: ${subject}`);
    } catch (error) {
        console.error('Erro ao enviar email via SMTP:', error.message);
    }
}

export const send2FACode = (toEmail, code) =>
    sendMail(
        'Seu codigo de acesso 2FA',
        `Seu codigo de autenticacao e: ${code}. Expira em ${budgetParams.twoFactorCodeExpiryMinutes} minutos.`,
        { to: toEmail, code, htmlBody: 'Use o codigo abaixo para concluir o login. Se voce nao tentou entrar, ignore este e-mail.' }
    );

export const sendNewDeviceAlert = (toEmail, code) =>
    sendMail(
        'Novo dispositivo detectado',
        `Detectamos um login a partir de um dispositivo novo. Se foi voce, use o codigo abaixo. Se nao foi voce, troque sua senha imediatamente.`,
        { to: toEmail, code }
    );

export const sendInactivityReauthCode = (toEmail, code) =>
    sendMail(
        'Sessao expirada por inatividade',
        `Sua sessao ficou inativa por mais de ${budgetParams.inactivityTimeoutMinutes} minutos e foi bloqueada por seguranca. Use o codigo abaixo para continuar.`,
        { to: toEmail, code }
    );

export const sendCardDueAlert = (cardName, dueDate, amount) =>
    sendMail(
        `Fatura do cartao ${cardName} vence em breve`,
        `A fatura do cartao "${cardName}" no valor de R$ ${amount.toFixed(2)} vence em ${dueDate}.`
    );

export const sendCardLimitAlert = (usagePercent) =>
    sendMail(
        'Uso de credito acima de 70%',
        `O uso total do limite de credito atingiu ${(usagePercent * 100).toFixed(0)}% do limite global disponivel.`
    );

export const sendSyncFailureAlert = (provider, errorMessage) =>
    sendMail(
        `Falha na sincronizacao com ${provider}`,
        `Nao foi possivel sincronizar os dados da conta/cartao via Open Finance (${provider}). Detalhe: ${errorMessage}. Use o assistente de importacao manual de OFX enquanto isso.`
    );

export const sendBudgetAlert = (categoryName, percent) =>
    sendMail(
        `Orcamento de "${categoryName}" atingiu ${(percent * 100).toFixed(0)}%`,
        `O gasto na categoria "${categoryName}" atingiu ${(percent * 100).toFixed(0)}% do teto configurado para este mes.`
    );
