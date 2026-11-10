export function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(value));
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
