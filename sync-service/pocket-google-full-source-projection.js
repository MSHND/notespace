"use strict";

// P349wz — pure, fail-closed projection of a trusted Google Docs get_document snapshot.
// This is NOT a Google API adapter, authority grant, publisher, or native .pocket conversion.
const { createHash } = require("node:crypto");
const PROJECTION = "google-paragraph-text-v1";
const STRUCTURE = "single-tab-plain-paragraphs";
const STYLE_NAMES = new Set(["NORMAL_TEXT","TITLE","SUBTITLE","HEADING_1","HEADING_2","HEADING_3","HEADING_4","HEADING_5","HEADING_6"]);
const SHA256 = v => createHash("sha256").update(Buffer.from(v,"utf8")).digest("hex");
const obj = x => x!==null && typeof x==="object" && !Array.isArray(x);
const allowed = (x, keys) => obj(x) && Object.keys(x).every(k=>keys.includes(k));
const nonempty = x => typeof x==="string" && x.length>0 && x.trim()===x;
const failure = reason => Object.freeze({ ok:false, reason });

// Canonical rule: remove exactly ONE structural \n terminator from each complete
// paragraph, join ALL paragraph payloads (including "") with ONE \n.
// A final empty paragraph therefore generates a trailing newline. Never trim/filter.
// Text is UTF-8 hashed, Google indexes are UTF-16 code units and checked separately.
// The separate structure witness preserves paragraph/run metadata but is NOT hierarchy.
function projectCompleteGoogleDocument({ snapshot, name, readPrincipal, expectedDocumentId,
  expectedRevisionId, expectedTabId }={}) {
  try {
    if (!nonempty(name) || !nonempty(readPrincipal) || !nonempty(expectedDocumentId)
        || !nonempty(expectedRevisionId) || !nonempty(expectedTabId))
      return failure("trusted-identity-missing");
    if (!obj(snapshot) || snapshot.documentId!==expectedDocumentId
        || snapshot.revisionId!==expectedRevisionId || !nonempty(snapshot.revisionId)
        || !Array.isArray(snapshot.tabs) || snapshot.tabs.length!==1)
      return failure("document-identity-or-tabs-invalid");
    if (!["SUGGESTIONS_INLINE","PREVIEW_SUGGESTIONS_ACCEPTED"].includes(snapshot.suggestionsViewMode))
      return failure("suggestions-mode-unsupported");
    if (snapshot.body?.content?.length) return failure("legacy-body-ambiguous");
    const tab=snapshot.tabs[0];
    if (!obj(tab) || tab.tabId!==expectedTabId || tab.documentId!==expectedDocumentId
        || tab.parentTabId!=null || tab.nestingLevel!=null && tab.nestingLevel!==0
        || !obj(tab.body) || !Array.isArray(tab.body.content))
      return failure("tab-identity-or-body-invalid");
    for (const key of ["headers","footers","footnotes","lists","namedRanges",
      "inlineObjects","positionedObjects","dropdownDefinitions",
      "suggestedNamedStylesChanges","suggestedDocumentStyleChanges"])
      if (tab[key]!=null && Object.keys(tab[key]).length>0)
        return failure("unsupported-tab-structure");
    const blocks=tab.body.content;
    if (blocks.length<2 || !allowed(blocks[0],["startIndex","endIndex","sectionBreak"])
        || blocks[0].endIndex!==1 || blocks[0].startIndex!=null && blocks[0].startIndex!==0
        || !allowed(blocks[0].sectionBreak,["sectionStyle"])
        || !allowed(blocks[0].sectionBreak.sectionStyle,
          ["columnSeparatorStyle","contentDirection","sectionType"])
        || blocks[0].sectionBreak.sectionStyle?.sectionType!=="CONTINUOUS"
        || blocks[0].sectionBreak.sectionStyle?.contentDirection!=="LEFT_TO_RIGHT"
        || blocks[0].sectionBreak.sectionStyle?.columnSeparatorStyle!=="NONE")
      return failure("section-break-invalid");
    let cursor=1;
    const paragraphs=[];
    const structure=[];
    for (const block of blocks.slice(1)) {
      if (!allowed(block,["startIndex","endIndex","paragraph"])
          || !obj(block.paragraph) || block.startIndex!==cursor
          || !Number.isSafeInteger(block.endIndex) || block.endIndex<=cursor
          || !allowed(block.paragraph,["elements","paragraphStyle","bullet"])
          || block.paragraph.bullet!=null
          || !Array.isArray(block.paragraph.elements)
          || block.paragraph.elements.length===0)
        return failure("unsupported-or-gapped-block");
      const ps=block.paragraph.paragraphStyle;
      if (!allowed(ps,["namedStyleType","direction","headingId"])
          || !STYLE_NAMES.has(ps.namedStyleType)
          || ps.direction!=null && ps.direction!=="LEFT_TO_RIGHT"
          || ps.headingId!=null && !nonempty(ps.headingId))
        return failure("unsupported-paragraph-style");
      let local=cursor,full="",runStyles=[];
      for (const el of block.paragraph.elements) {
        if (!allowed(el,["startIndex","endIndex","textRun"])
            || el.startIndex!==local || !Number.isSafeInteger(el.endIndex)
            || !allowed(el.textRun,["content","textStyle"])
            || typeof el.textRun.content!=="string" || el.textRun.content.length===0
            || el.endIndex!==local+el.textRun.content.length
            || !allowed(el.textRun.textStyle??{},["bold","italic","underline","strikethrough"])
            || Object.values(el.textRun.textStyle??{}).some(v=>typeof v!=="boolean")
            || Object.keys(el).some(k=>/suggested/i.test(k)))
          return failure("unsupported-or-gapped-text-run");
        full+=el.textRun.content;
        runStyles.push({ lengthUtf16:el.textRun.content.length,
          textStyle:{...(el.textRun.textStyle??{})} });
        local=el.endIndex;
      }
      if (local!==block.endIndex || !full.endsWith("\n")
          || full.slice(0,-1).includes("\n"))
        return failure("paragraph-termination-invalid");
      const body=full.slice(0,-1);
      paragraphs.push({text:body});
      structure.push({startIndex:block.startIndex,endIndex:block.endIndex,
        namedStyleType:ps.namedStyleType,headingId:ps.headingId??null,
        direction:ps.direction??null,runs:runStyles});
      cursor=block.endIndex;
    }
    const canonicalText=paragraphs.map(p=>p.text).join("\n");
    const audit={
      version:"google-structure-audit-v1",paragraphCount:paragraphs.length,
      blankOrWhitespaceOnlyCount:paragraphs.filter(p=>p.text.trim()==="").length,
      terminalParagraphIsBlank:paragraphs.at(-1).text==="",
      styles:structure,
    };
    const fixture={
      name,documentId:expectedDocumentId,tabId:expectedTabId,
      revisionId:expectedRevisionId,readPrincipal,
      structure:STRUCTURE,projectionVersion:PROJECTION,
      paragraphs,canonicalText,digest:SHA256(canonicalText),
    };
    return Object.freeze({ok:true,fixture,
      witness:Object.freeze({...audit,
        sha256:SHA256(JSON.stringify(audit)),
        losslessProjection:"paragraph text, ordering, blanks, UTF-8; style witness separate and non-executable",
      })});
  } catch (_error) {return failure("malformed-source");}
}
module.exports=Object.freeze({PROJECTION,STRUCTURE,projectCompleteGoogleDocument});
