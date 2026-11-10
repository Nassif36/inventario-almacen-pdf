export function catalogFilename(date = new Date()) {
  const month = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(date);
  const monthName = month[0].toLocaleUpperCase('es-AR') + month.slice(1);
  return `El Hornero Market - ${monthName}`;
}
