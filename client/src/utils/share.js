export function buildShareUrl(hashPath) {
  return `${window.location.origin}${window.location.pathname}#${hashPath}`;
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export async function shareLink({ title, text, url }) {
  if (navigator.share) {
    await navigator.share({ title, text, url });
    return true;
  }
  await copyText(url);
  return false;
}
