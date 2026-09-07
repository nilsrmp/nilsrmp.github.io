export const OFFICE_FORMATS: Record<string, string[]> = Object.assign(Object.create(null), {
  doc: ["pdf", "docx", "odt"],
  docx: ["pdf", "odt"],
  odt: ["pdf", "docx"],
  xls: ["pdf", "xlsx", "ods"],
  xlsx: ["pdf", "ods"],
  ods: ["pdf", "xlsx"],
  ppt: ["pdf"],
  pptx: ["pdf"],
  odp: ["pdf"],
});
export const extension = (name: string) =>
  name.split(".").pop()?.toLowerCase() ?? "";
export async function convertOffice(file: File, target: string) {
  const response = await fetch(
    `/api/office/convert?target=${target}&ext=${extension(file.name)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
      signal: AbortSignal.timeout(100_000),
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.error || "Die Dokumentkonvertierung ist fehlgeschlagen.",
    );
  }
  const blob = await response.blob();
  if (!blob.size || blob.type.includes("text/html"))
    throw new Error("Der Dokumentdienst ist nicht erreichbar.");
  return [{ name: `${file.name.replace(/\.[^.]+$/, "")}.${target}`, blob }];
}
