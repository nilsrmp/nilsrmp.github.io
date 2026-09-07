import { test, expect } from "@playwright/test";
import { zipSync, strToU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

test("codes route to distinct sections and unknown codes stay on landing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "nilsrump" }).click();
  await page.getByLabel("Zugangscode", { exact: true }).fill("unknown");
  await page.getByRole("button", { name: "Code senden" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Dieser Code ist nicht bekannt.",
  );
  await page.getByLabel("Zugangscode", { exact: true }).fill(" convert ");
  await page.getByRole("button", { name: "Code senden" }).click();
  await expect(page).toHaveURL(/#\/convert\/bilder$/);
  await expect(page.getByRole("heading")).toContainText("Ein neues Format.");
  await page.getByRole("link", { name: "Zur Startseite" }).click();
  await page.getByRole("button", { name: "nilsrump" }).click();
  await page.getByLabel("Zugangscode", { exact: true }).fill("OFFICE");
  await page.getByRole("button", { name: "Code senden" }).click();
  await expect(
    page.getByRole("link", { name: "Dokumente", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Dokumente", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("real image formats, lossless JPEG rename, image PDF and PDF page exports", async ({
  page,
}) => {
  await page.goto("/#/convert/bilder");
  const result = await page.evaluate(async () => {
    const { convertLocal } = await import("/src/lib/conversion.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 8;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#7855ff";
    context.fillRect(0, 0, 6, 8);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const file = new File([blob], "test.png", { type: "image/png" });
    const results: Record<string, unknown> = {};
    for (const format of ["jpg", "jpeg", "png", "webp", "pdf"] as const) {
      const [output] = await convertLocal(file, format, 0.9);
      results[format] = {
        type: output.blob.type,
        name: output.name,
        bytes: output.blob.size,
      };
      if (format === "jpg") {
        const bitmap = await createImageBitmap(output.blob);
        context.clearRect(0, 0, 12, 8);
        context.drawImage(bitmap, 0, 0);
        results.white = Array.from(context.getImageData(11, 4, 1, 1).data);
        const [renamed] = await convertLocal(
          new File([output.blob], "original.jpeg", { type: "image/jpeg" }),
          "jpg",
          0.1,
        );
        results.lossless =
          JSON.stringify(
            Array.from(new Uint8Array(await renamed.blob.arrayBuffer())),
          ) ===
          JSON.stringify(
            Array.from(new Uint8Array(await output.blob.arrayBuffer())),
          );
      }
      if (format === "pdf") {
        results.pdfHeader = new TextDecoder().decode(
          await output.blob.slice(0, 5).arrayBuffer(),
        );
        for (const target of ["png", "jpg", "webp"] as const) {
          const pages = await convertLocal(
            new File([output.blob], "test.pdf", { type: "application/pdf" }),
            target,
            0.9,
          );
          results["pdf-" + target] = {
            count: pages.length,
            type: pages[0].blob.type,
            name: pages[0].name,
          };
        }
      }
    }
    return results;
  });
  for (const [format, type] of Object.entries({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
  }))
    expect(result[format]).toMatchObject({ type, name: `test.${format}` });
  expect(result.lossless).toBe(true);
  for (const channel of (result.white as number[]).slice(0, 3)) expect(channel).toBeGreaterThanOrEqual(250);
  expect((result.white as number[])[3]).toBe(255);
  expect(result.pdfHeader).toBe("%PDF-");
  expect(result["pdf-png"]).toEqual({
    count: 1,
    type: "image/png",
    name: "test-page-01.png",
  });
  expect(result["pdf-jpg"]).toMatchObject({ count: 1, type: "image/jpeg" });
  expect(result["pdf-webp"]).toMatchObject({ count: 1, type: "image/webp" });
});

test("batch conversion, downloads, ZIP and corrupt input handling", async ({
  page,
}) => {
  await page.goto("/#/convert/bilder");
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 10;
    c.height = 10;
    return Array.from(
      new Uint8Array(
        await (
          await new Promise<Blob>((r) => c.toBlob((b) => r(b!)))
        ).arrayBuffer(),
      ),
    );
  });
  await page.getByLabel("Dateien auswählen", { exact: true }).setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: Buffer.from(bytes) },
    { name: "two.png", mimeType: "image/png", buffer: Buffer.from(bytes) },
  ]);
  await page.getByRole("button", { name: "Konvertieren", exact: true }).click();
  await expect(page.getByRole("link", { name: "one.jpg" })).toBeVisible();
  await expect(page.getByRole("link", { name: "two.jpg" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Alle Ergebnisse als ZIP herunterladen" })
    .click();
  const saved = await download;
  const archive = unzipSync(await readFile((await saved.path())!));
  expect(Object.keys(archive)).toEqual(["one.jpg", "two.jpg"]);
  expect(Array.from(archive["one.jpg"].slice(0, 3))).toEqual([255, 216, 255]);
  await page
    .getByLabel("Dateien auswählen", { exact: true })
    .setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("broken"),
    });
  await page.getByRole("button", { name: "Konvertieren", exact: true }).click();
  await expect(page.getByText("Der Dateiinhalt stimmt nicht mit dem angegebenen Format überein.", { exact: true })).toBeVisible();
});

test("reject unsupported, empty and oversize inputs; PDF limit", async ({
  page,
}) => {
  await page.goto("/#/convert/bilder");
  await page
    .getByLabel("Dateien auswählen", { exact: true })
    .setInputFiles({
      name: "movie.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("video"),
    });
  await expect(page.getByRole("alert")).toContainText(
    "Dateiformat wird hier nicht unterstützt",
  );
  const doc = await PDFDocument.create();
  for (let i = 0; i < 41; i++) doc.addPage();
  const pdfBytes = Array.from(await doc.save());
  const errors = await page.evaluate(async (pdfBytes) => {
    const { convertLocal } = await import("/src/lib/conversion.ts");
    const files = [
      new File([], "empty.png", { type: "image/png" }),
      new File([new Uint8Array(30 * 1024 * 1024 + 1)], "big.png", {
        type: "image/png",
      }),
      new File([new Uint8Array(pdfBytes)], "long.pdf", { type: "application/pdf" }),
    ];
    const result = [];
    for (const f of files)
      try {
        await convertLocal(f, "png", 0.9);
        result.push("unexpected-success");
      } catch (e) {
        result.push((e as Error).message);
      }
    return result;
  }, pdfBytes);
  expect(errors).toHaveLength(3);
  expect(errors.join(" ")).not.toContain("unexpected-success");
  expect(errors[2]).toContain("40");
});

test("Office unavailable state disables upload action and leaves images usable", async ({
  page,
}) => {
  await page.route("**/api/office/status", (route) =>
    route.fulfill({ json: { available: false } }),
  );
  await page.goto("/#/convert/dokumente");
  await expect(page.getByRole("status")).toContainText(
    "aktuell nicht verfügbar",
  );
  await expect(
    page.getByRole("button", { name: "Konvertieren", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Bilder & PDF" }).click();
  await expect(
    page.getByText("Lokal im Browser", { exact: true }),
  ).toBeVisible();
});

test("Office file converts via UI to a real PDF", async ({ page, request }) => {
  const status = await request.get("/api/office/status");
  test.skip(!(await status.json()).available, "LibreOffice is not installed");
  const file = zipSync({
    mimetype: strToU8("application/vnd.oasis.opendocument.text"),
    "META-INF/manifest.xml": strToU8(
      '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
    ),
    "content.xml": strToU8(
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text><text:p>Converter verification</text:p></office:text></office:body></office:document-content>',
    ),
  });
  await page.goto("/#/convert/dokumente");
  await page
    .getByLabel("Dateien auswählen", { exact: true })
    .setInputFiles({
      name: "example.odt",
      mimeType: "application/vnd.oasis.opendocument.text",
      buffer: Buffer.from(file),
    });
  await page.getByRole("button", { name: "Konvertieren", exact: true }).click();
  const link = page.getByRole("link", { name: "example.pdf" });
  await expect(link).toBeVisible();
  const download = page.waitForEvent("download");
  await link.click();
  const saved = await download;
  expect(
    (await readFile((await saved.path())!)).subarray(0, 5).toString(),
  ).toBe("%PDF-");
});

test("desktop and mobile layouts fit viewport and render cleanly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/convert/bilder");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await expect(page.getByRole("heading")).toBeVisible();
  await expect(page.locator(".converter-card")).toHaveCSS("opacity", "1");
  await expect(page.locator(".converter-intro")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "test-results/converter-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: "test-results/converter-mobile.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "Dokumente", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  expect(errors).toEqual([]);
});
