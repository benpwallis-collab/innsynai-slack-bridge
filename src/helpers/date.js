export function getRelativeDate(dateString) {
  const now = new Date();
  const then = new Date(dateString);
  const diff = now - then;

  const sec = diff / 1000;
  const min = sec / 60;
  const hr = min / 60;
  const day = hr / 24;

  if (day >= 2) return `${Math.floor(day)} days ago`;
  if (day >= 1) return "1 day ago";
  if (hr >= 1) return `${Math.floor(hr)} hours ago`;
  if (min >= 1) return `${Math.floor(min)} minutes ago`;
  return "just now";
}
