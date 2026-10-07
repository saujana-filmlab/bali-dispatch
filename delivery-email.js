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
    const logoUrl = escapeHtml(settings.logoUrl || "https://bali-darkroom.saujanalab.com/email-assets/saujana-bali-orange.png");
    const textureUrl = escapeHtml(settings.textureUrl === undefined ? "https://bali-darkroom.saujanalab.com/email-assets/film-grain.png" : settings.textureUrl);
    const texture = textureUrl ? `background="${textureUrl}"` : "";
    const texturedStyle = textureUrl ? `background-image:url('${textureUrl}');background-repeat:repeat;` : "";
    const font = "'Helvetica Neue',Helvetica,Arial,sans-serif";
    const mono = "'Courier New',Courier,monospace";
    const sprockets = Array.from({length:14}, () => `<td width="7.14%" style="padding:0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="12" bgcolor="#080402" style="height:12px;font-size:0;line-height:0;background-color:#080402;">&nbsp;</td></tr></table></td>`).join("");
    const notes = order.notes ? `
      <tr><td style="padding:0 28px 24px;color:#f3c3a2;">
        <p style="margin:0 0 10px;font-family:${mono};font-size:12px;line-height:18px;font-weight:bold;color:#ff6425;">A NOTE FROM THE LAB</p>
        <p style="margin:0;padding:0 0 0 14px;border-left:2px solid #ff6425;font-size:14px;line-height:23px;color:#f3c3a2;">${escapeHtml(order.notes).replace(/\r?\n/g, "<br>")}</p>
      </td></tr>` : "";

    // Inline styles and presentation tables keep the pasted body independent of page CSS.
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#100704" ${texture} style="width:100%;max-width:600px;border-collapse:collapse;background-color:#100704;${texturedStyle}font-family:${font};text-align:left;color:#f3c3a2;">
      <tr><td bgcolor="#271109" style="padding:13px 16px 10px;background-color:#271109;border-bottom:1px solid #58301d;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>
          <td style="padding:0 8px 10px;font-family:${mono};font-size:10px;line-height:16px;font-weight:bold;color:#ff6425;">SAUJANA FILM LAB &middot; BALI</td>
          <td align="right" style="padding:0 8px 10px;font-family:${mono};font-size:10px;line-height:16px;color:#f3c3a2;">135</td>
        </tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;"><tr>${sprockets}</tr></table>
      </td></tr>
      <tr><td style="padding:30px 28px 27px;">
        <img src="${logoUrl}" width="224" alt="Saujana Film Lab Bali" style="display:block;width:224px;max-width:100%;height:auto;border:0;">
        <p style="margin:22px 0 0;font-family:${mono};font-size:10px;line-height:17px;font-weight:bold;color:#ff6425;">DEVELOPING &nbsp;&middot;&nbsp; SCANNING &nbsp;&middot;&nbsp; FILM SUPPLIES</p>
      </td></tr>
      <tr><td style="padding:0 28px 27px;">
        <p style="margin:0 0 18px;font-family:${mono};font-size:12px;line-height:19px;color:#ff6425;">ORDER COMPLETE &nbsp;/&nbsp; <strong>${number}</strong></p>
        <p style="margin:0;font-family:${font};font-size:40px;line-height:40px;font-weight:bold;color:#ff6425;">YOUR SCANS<br>ARE READY.</p>
        <p style="margin:18px 0 0;font-size:16px;line-height:24px;color:#f3c3a2;">Hi <strong>${name}!</strong></p>
      </td></tr>
      <tr><td style="padding:0 28px 28px;">
        <p style="margin:0 0 20px;font-size:16px;line-height:25px;color:#f3c3a2;">Tap or click the button below to view and download your scans:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr><td bgcolor="#ff6425" style="background-color:#ff6425;text-align:center;">
            <a href="${scansUrl}" style="display:block;padding:18px 12px;color:#100704;font-family:${font};font-size:14px;line-height:20px;font-weight:bold;text-decoration:none;"><strong style="color:#100704;">OPEN YOUR SCANS</strong></a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 28px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:22px 0 0;border-top:1px solid #58301d;">
            <p style="margin:0 0 16px;font-family:${mono};font-size:12px;line-height:19px;font-weight:bold;color:#ff6425;">BEFORE YOU GET INTO THE PHOTOS</p>
            <p style="margin:0 0 12px;font-size:14px;line-height:23px;color:#f3c3a2;">Your link will stay active for <strong style="color:#ff6425;">7 days</strong>, so please download everything before it expires.</p>
            <p style="margin:0;font-size:14px;line-height:23px;color:#f3c3a2;">When collecting your negatives, just quote order number <strong>${number}</strong>.</p>
          </td></tr>
        </table>
      </td></tr>${notes}
      <tr><td style="padding:0 28px 28px;">
        <p style="margin:0;font-size:14px;line-height:23px;color:#f3c3a2;">Thanks for trusting us with your roll. We hope there's a frame in there that makes you go, yep, that's the one. Cheers!</p>
      </td></tr>
      <tr><td style="padding:0 28px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td style="padding:22px 0 0;border-top:1px solid #58301d;">
          <p style="margin:0 0 12px;font-size:14px;line-height:22px;font-weight:bold;color:#ff6425;">Auto-generated email. Actual humans on the other end.</p>
          <p style="margin:0;font-size:14px;line-height:23px;color:#f3c3a2;">Hit reply, DM us on <a href="https://www.instagram.com/saujanabali" style="color:#f3c3a2;text-decoration:underline;font-weight:bold;">Instagram</a>, or message us on <a href="https://wa.me/6282251318377" style="color:#f3c3a2;text-decoration:underline;font-weight:bold;">WhatsApp</a>. We're cool like that.</p>
        </td></tr></table>
      </td></tr>
      <tr><td bgcolor="#271109" style="padding:12px 16px;background-color:#271109;border-top:1px solid #58301d;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;"><tr>${sprockets}</tr></table>
      </td></tr>
    </table><p style="margin:0;padding:0;line-height:16px;">&nbsp;</p>`;
  }

  root.buildSaujanaDeliveryEmail = buildDeliveryEmail;
  root.buildSaujanaDeliveryEmailText = function (order) {
    const notes = order.notes ? `\n\nNotes from the lab:\n${order.notes}` : "";
    return `Hi ${order.custName}!\n\nYour scans are ready 🎞️✨\n\nOrder Number: ${order.orderNumber}${notes}\n\nTap or click the link below to view and download your scans:\n\nOPEN YOUR SCANS\n${order.shortUrl || order.url}\n\nBefore you get into the photos:\n- Your link will stay active for 7 days, so please download everything before it expires.\n- When collecting your negatives, just quote order number ${order.orderNumber}.\n\nThanks for trusting us with your roll. We hope there's a frame in there that makes you go, yep, that's the one. Cheers!\n\nAuto-generated email. Actual humans on the other end.\nHit reply, DM us on Instagram, or message us on WhatsApp. We're cool like that.\nInstagram: https://www.instagram.com/saujanabali\nWhatsApp: https://wa.me/6282251318377`;
  };
}(typeof window === "undefined" ? globalThis : window));
