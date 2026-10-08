(function (root) {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildDeliveryEmail(order, options) {
    const settings = options || {};
    const name = escapeHtml(order.custName);
    const number = escapeHtml(order.orderNumber);
    const url = new URL(order.shortUrl || order.url);
    if (!/^https?:$/.test(url.protocol)) throw new Error("A web delivery link is required.");
    const scansUrl = escapeHtml(url.href);
    let selectedTheme = order.deliveryTheme;
    if (!selectedTheme) {
      try { selectedTheme = new URL(order.url || order.shortUrl).searchParams.get("negative"); }
      catch { selectedTheme = "colour"; }
    }
    const theme = String(selectedTheme || "").trim().toLowerCase();
    const palettes = {
      colour:{accent:"#ff6425",paper:"#f3c3a2",sleeve:"#100704",strip:"#271109",line:"#58301d",inset:"#201009",insetLine:"#4a271a",hole:"#080402",muted:"#cfb8a8",logo:"saujana-bali-orange.png",texture:"film-grain.png"},
      classic:{accent:"#c9a15c",paper:"#ece7db",sleeve:"#0a0b0c",strip:"#1a1d20",line:"#4b402c",inset:"#181b1e",insetLine:"#3d362a",hole:"#050607",muted:"#bab5aa",logo:"saujana-bali-classic.png",texture:"film-grain-mono.png"},
      bw:{accent:"#eeeae2",paper:"#f3f1eb",sleeve:"#090909",strip:"#1b1b1b",line:"#444444",inset:"#171717",insetLine:"#383838",hole:"#040404",muted:"#c4c3be",logo:"saujana-bali-bw.png",texture:"film-grain-mono.png"}
    };
    const palette = Object.prototype.hasOwnProperty.call(palettes,theme) ? palettes[theme] : palettes.colour;
    const assetBase = "https://bali-darkroom.saujanalab.com/email-assets/";
    const logoUrl = escapeHtml(settings.logoUrl || assetBase + palette.logo);
    const textureUrl = escapeHtml(settings.textureUrl === undefined ? assetBase + palette.texture : settings.textureUrl);
    const texture = textureUrl ? `background="${textureUrl}"` : "";
    const texturedStyle = textureUrl ? `background-image:url('${textureUrl}');background-repeat:repeat;` : "";
    const font = "'Helvetica Neue',Helvetica,Arial,sans-serif";
    const mono = "'Courier New',Courier,monospace";
    const sprockets = Array.from({length:14}, () => `<td width="7.14%" style="padding:0 3px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="saujana-perforation" height="10" bgcolor="${palette.hole}" style="height:10px;font-size:0;line-height:0;background-color:${palette.hole};">&nbsp;</td></tr></table></td>`).join("");
    const notes = order.notes ? `
      <tr><td style="padding:0 24px 20px;color:${palette.paper};">
        <p style="margin:0 0 10px;font-family:${mono};font-size:12px;line-height:18px;font-weight:bold;color:${palette.accent};">A NOTE FROM THE LAB</p>
        <p style="margin:0;padding:0 0 0 14px;border-left:2px solid ${palette.accent};font-size:14px;line-height:23px;color:${palette.paper};">${escapeHtml(order.notes).replace(/\r?\n/g, "<br>")}</p>
      </td></tr>` : "";

    // Explicit cell colours and table spacing preserve readability without texture or rounding.
    const sleeve = `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]--><table role="presentation" class="saujana-email-sleeve" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${palette.sleeve}" ${texture} style="width:100%;max-width:600px;table-layout:fixed;word-wrap:break-word;word-break:break-word;border-collapse:separate;border-spacing:0;border:1px solid ${palette.line};border-radius:20px;overflow:hidden;background-color:${palette.sleeve};${texturedStyle}font-family:${font};text-align:left;color:${palette.paper};">
      <tr><td bgcolor="${palette.strip}" style="padding:10px 16px 10px;background-color:${palette.strip};border-bottom:1px solid ${palette.line};border-radius:19px 19px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>
          <td style="padding:0 6px 7px;font-family:${mono};font-size:9px;line-height:14px;font-weight:bold;color:${palette.accent};">SAUJANA FILM LAB &middot; BALI</td>
          <td align="right" style="padding:0 6px 7px;font-family:${mono};font-size:9px;line-height:14px;color:${palette.paper};">135</td>
        </tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;"><tr>${sprockets}</tr></table>
      </td></tr>
      <tr><td style="padding:18px 24px 16px;">
        <img src="${logoUrl}" width="200" height="62" alt="Saujana Film Lab Bali" style="display:block;width:200px;max-width:100%;height:62px;border:0;color:${palette.accent};font-family:${font};font-size:14px;line-height:20px;">
        <p style="margin:10px 0 0;font-family:${mono};font-size:9px;line-height:15px;font-weight:bold;color:${palette.accent};">DEVELOPING &nbsp;&middot;&nbsp; SCANNING &nbsp;&middot;&nbsp; FILM SUPPLIES</p>
      </td></tr>
      <tr><td style="padding:0 24px 18px;word-wrap:break-word;word-break:break-word;">
        <p style="margin:0 0 10px;font-family:${mono};font-size:10px;line-height:16px;color:${palette.accent};">ORDER COMPLETE &nbsp;/&nbsp; <strong>${number}</strong></p>
        <p style="margin:0;font-family:${font};font-size:34px;line-height:35px;font-weight:bold;color:${palette.accent};">YOUR SCANS<br>ARE READY.</p>
        <p style="margin:14px 0 0;font-size:16px;line-height:24px;color:${palette.paper};">Hi <strong>${name}!</strong></p>
      </td></tr>
      <tr><td style="padding:0 24px 22px;">
        <p style="margin:0 0 16px;font-size:14px;line-height:23px;color:${palette.paper};">Tap or click the button below to view and download your scans:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr><td bgcolor="${palette.accent}" style="background-color:${palette.accent};border-radius:8px;text-align:center;">
            <a href="${scansUrl}" style="display:block;padding:16px 12px;border:1px solid ${palette.accent};border-radius:8px;background-color:${palette.accent};color:${palette.sleeve};font-family:${font};font-size:14px;line-height:20px;font-weight:bold;text-decoration:none;"><strong style="color:${palette.sleeve};">OPEN YOUR SCANS</strong></a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 20px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${palette.inset}" style="width:100%;border-collapse:separate;border-spacing:0;border:1px solid ${palette.insetLine};border-radius:8px;background-color:${palette.inset};">
          <tr><td bgcolor="${palette.inset}" style="padding:16px 18px;background-color:${palette.inset};border-radius:7px;">
            <p style="margin:0 0 12px;font-family:${mono};font-size:10px;line-height:17px;font-weight:bold;color:${palette.accent};">BEFORE YOU GET INTO THE PHOTOS</p>
            <p style="margin:0 0 12px;font-size:14px;line-height:23px;color:${palette.paper};">Your link will stay active for <strong style="color:${palette.accent};">7 days</strong>, so please download everything before it expires.</p>
            <p style="margin:0;font-size:14px;line-height:23px;color:${palette.paper};">When collecting your negatives, just quote order number <strong>${number}</strong>.</p>
          </td></tr>
        </table>
      </td></tr>${notes}
      <tr><td style="padding:0 24px 20px;">
        <p style="margin:0;font-size:14px;line-height:23px;color:${palette.paper};">Thanks for trusting us with your roll. We hope there's a frame in there that makes you go, yep, that's the one. Cheers!</p>
      </td></tr>
      <tr><td style="padding:0 24px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td style="padding:18px 0 0;border-top:1px solid ${palette.line};">
          <p style="margin:0 0 12px;font-size:14px;line-height:22px;font-weight:bold;color:${palette.accent};">Auto-generated email. Actual humans on the other end.</p>
          <p style="margin:0;font-size:14px;line-height:23px;color:${palette.paper};">Hit reply, DM us on <a href="https://www.instagram.com/saujanabali" style="color:${palette.paper};text-decoration:underline;font-weight:bold;">Instagram</a>, or message us on <a href="https://wa.me/6282251318377" style="color:${palette.paper};text-decoration:underline;font-weight:bold;">WhatsApp</a>. We're cool like that.</p>
        </td></tr></table>
      </td></tr>
      <tr><td bgcolor="${palette.strip}" style="padding:12px 16px;background-color:${palette.strip};border-top:1px solid ${palette.line};border-radius:0 0 19px 19px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;"><tr>${sprockets}</tr></table>
      </td></tr>
    </table><!--[if mso]></td></tr></table><![endif]-->`;
    const previewSignature = settings.includePreviewSignature ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;text-align:left;"><tr><td style="padding:24px 8px 0;font-family:${font};font-size:13px;line-height:20px;color:${palette.muted};"><strong style="color:${palette.paper};">Saujana Film Lab Bali</strong><br>Bali, Indonesia</td></tr></table>` : "";
    const outerTextureUrl = escapeHtml(settings.outerTextureUrl === undefined ? "https://bali-darkroom.saujanalab.com/email-assets/outer-charcoal-dots.png" : settings.outerTextureUrl);
    const outerBackground = outerTextureUrl ? `background="${outerTextureUrl}"` : "";
    const outerStyle = outerTextureUrl ? `background-image:url('${outerTextureUrl}');background-repeat:repeat;` : "";
    return `<table role="presentation" class="saujana-email-surround" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#171716" style="width:100%;border-collapse:collapse;background-color:#171716;"><tr><td align="center" bgcolor="#171716" ${outerBackground} style="padding:24px 16px 32px;background-color:#171716;${outerStyle}">${sleeve}${previewSignature}</td></tr></table>`;
  }

  root.buildSaujanaDeliveryEmail = buildDeliveryEmail;
  root.buildSaujanaDeliveryEmailText = function (order) {
    const notes = order.notes ? `\n\nNotes from the lab:\n${order.notes}` : "";
    return `Hi ${order.custName}!\n\nYour scans are ready 🎞️✨\n\nOrder Number: ${order.orderNumber}${notes}\n\nTap or click the link below to view and download your scans:\n\nOPEN YOUR SCANS\n${order.shortUrl || order.url}\n\nBefore you get into the photos:\n- Your link will stay active for 7 days, so please download everything before it expires.\n- When collecting your negatives, just quote order number ${order.orderNumber}.\n\nThanks for trusting us with your roll. We hope there's a frame in there that makes you go, yep, that's the one. Cheers!\n\nAuto-generated email. Actual humans on the other end.\nHit reply, DM us on Instagram, or message us on WhatsApp. We're cool like that.\nInstagram: https://www.instagram.com/saujanabali\nWhatsApp: https://wa.me/6282251318377`;
  };
}(typeof window === "undefined" ? globalThis : window));
