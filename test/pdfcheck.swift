import PDFKit
let d = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let s = (d.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
let size = d.page(at: 0)!.bounds(for: .mediaBox).size
let lengths = (0..<d.pageCount).map { d.page(at: $0)!.string?.count ?? 0 }
print("{\"pages\":\(d.pageCount),\"width\":\(size.width),\"height\":\(size.height),\"first\":\(s.hasPrefix("This is a long entry")),\"last\":\(s.contains("THE LAST SENTENCE")),\"ui\":\(s.contains("New Entry") || s.contains("Begin anywhere")),\"copies\":\(s.components(separatedBy: "THE LAST SENTENCE").count - 1),\"pageChars\":\(lengths)}")
