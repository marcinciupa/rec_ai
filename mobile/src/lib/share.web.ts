// Web: Web Share API nie udostępnia lokalnych plików po URI (trzeba by je najpierw wgrać).
// W podglądzie web SHARE jest no-opem.
export async function shareRecording(_uri?: string, _name?: string): Promise<void> {
  // brak udostępniania lokalnego pliku audio na web
}
