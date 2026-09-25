/**
 * The Design Better logo for the top of every outbound email, so people know
 * who it's from. PNG, not SVG (Gmail and Outlook drop SVG), flattened on white
 * so it survives dark-mode clients. Always served from production so previews
 * and sends load the same file.
 */
export const EMAIL_LOGO = `<a href="https://designbetter.careers" style="display:inline-block;margin:0 0 24px;text-decoration:none;"><img src="https://designbetter.careers/logos/DesignBetterBlack-email.png" width="90" height="48" alt="Design Better" style="display:block;width:90px;height:48px;border:0;"></a>`;
