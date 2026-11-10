import { getDatabase } from '../database/db.js';

export async function getSetting(key) {
  const record = await getDatabase().settings.get(key);
  return record?.value ?? null;
}

export async function setSetting(key, value) {
  await getDatabase().settings.put({ key, value });
}
