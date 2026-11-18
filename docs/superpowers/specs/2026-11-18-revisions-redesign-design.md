# Revisions screen redesign

## Intent

The Revisions tab of a revision channel looks dated: one column with the video, a version row, an add box and a card
list stacked top to bottom. The user supplied a mockup: a revision list on the left, the video and the create form on
the right. The goal is that look, with the features the mockup implies, without server changes.

## Decisions (the user's)

- A revision stays pinned to **one moment** of the video. No start–end range, no schema change.
- **Layout A:** the video always sits on top of the right column. Next to it, the right column shows either the create
  form or the selected revision's detail (in place of the form). "Revizyon Oluştur" brings the form back.

## Approaches considered

- **Single moment, webapp only** (picked): every element of the mockup except the range; fast, low risk.
- Real range: needs a video end time on tasks, a migration and server changes; rejected by the user as not needed.
- Detail as a third column (today's panel): keeps current code but squeezes the video and the form; rejected for A.

## Design

**Left column: the list**
- Header "Revizyonlar", a one-line subtitle, and a "Revizyon Oluştur" button (managers only) that clears the
  selection and shows the form.
- A search box (matches the revision title, case-insensitive) and a status filter: Tüm Durumlar, Revizyon İstendi
  (todo), İnceleniyor (in_progress), Tamamlandı (done).
- Cards: still with a play mark and the moment, the title, a version badge (vN), the creation date, a status pill in the
  status colour, and a ⋮ menu. The selected card is outlined in the accent colour.
- The ⋮ menu holds Delete for managers; others get no menu.
- The list keeps today's rule: a version shows its own revisions, the latest also shows older ones still open.

**Right column: video plus form or detail**
- Above the video: the version picker and "Yeni sürüm yükle" (managers), as today.
- The video, as today (frame stepping with ← and → stays, its hint moves to a tooltip).
- Under the video: the moment (mm:ss.cc), "Mevcut Süreyi Kullan" (sets the moment from the player), and a filmstrip of
  evenly spaced frames with a marker at the moment; clicking the strip seeks.
- **Form** (no revision selected): "Revizyon Açıklaması" (required, counter 0/500; it becomes the revision title, which
  the cards show), optional "Referans / Ek Görsel" (PNG, JPG, WEBP up to 10 MB, drag-drop or pick, a preview with a
  remove ×), İptal (clears the form) and "Revizyon Oluştur".
- **Detail** (a revision selected): the existing task detail (status, assignee, dates, comments) in place of the form;
  the video seeks to its moment, switching version first if needed.
- Non-managers see no form: the right column shows the video and "Bir revizyon seçin".

**Reference image:** after the revision is created, the image is sent as its first comment with no text (the server
accepts a file-only comment). It then shows in the revision's comments.

**Narrow screens:** the two columns stack, list first.

## Left to the builder

Exact spacing and colours follow the existing tasks.scss tokens; the filmstrip frame count fits the width (about 10).
All new strings get en and tr entries.

## Not doing

Ranges, a separate description field, new statuses, server changes.
