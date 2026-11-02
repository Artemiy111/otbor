import { describe, expect, test } from "bun:test"
import { findFolderByRole, folderRole, type MailFolder } from "../src/index.ts"

describe("folder roles", () => {
  test("prefers special-use flags", () => {
    expect(folderRole("INBOX")).toBe("inbox")
    expect(folderRole("INBOX", "\\Inbox")).toBe("inbox")
    expect(folderRole("Some/Path", "\\Sent")).toBe("sent")
    expect(folderRole("Some/Path", "\\Archive")).toBe("archive")
    expect(folderRole("Some/Path", "\\Junk")).toBe("spam")
    expect(folderRole("Some/Path", "\\Trash")).toBe("trash")
    expect(folderRole("Some/Path")).toBe("other")
  })

  test("falls back to common folder names", () => {
    expect(folderRole("[Gmail]/Sent Mail")).toBe("sent")
    expect(folderRole("Sent Items")).toBe("sent")
    expect(folderRole("Отправленные")).toBe("sent")
    expect(folderRole("Archive")).toBe("archive")
    expect(folderRole("Junk E-mail")).toBe("spam")
    expect(folderRole("Deleted Messages")).toBe("trash")
    expect(folderRole("Projects")).toBe("other")
  })

  test("does not treat Gmail All Mail as archive", () => {
    expect(folderRole("[Gmail]/All Mail", "\\All")).toBe("other")
  })

  test("missing Sent is null, not an error", () => {
    const inboxOnly: MailFolder[] = [
      { path: "INBOX", name: "Inbox", role: "inbox", uidValidity: "1" }
    ]
    expect(findFolderByRole(inboxOnly, "inbox")?.path).toBe("INBOX")
    expect(findFolderByRole(inboxOnly, "sent")).toBeNull()
  })
})
