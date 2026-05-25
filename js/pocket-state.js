/* State, DOM references, runtime flags. */

const url = new URL(window.location.href);
const isPipMode = url.searchParams.get("pip") === "1";
if (isPipMode) document.body.classList.add("pipMode");
const PIP_SNAPSHOT_KEY = "pocketLite.pip.snapshot.v1";
const AUTO_CACHE_KEY = "pocketLite.auto.cache.v1";
const WORKSPACE_STATE_KEY = "pocketLite.workspace.state.v1";
const LOCAL_SAFETY_KEY = "pocketLite.localSafety.snapshot.v1";
const LOCAL_SAFETY_TRAIL_KEY = "pocketLite.localSafety.trail.v1";
const LOCAL_SAFETY_TRAIL_MAX = 8;
const LAST_BACKUP_META_KEY = "pocketLite.lastBackup.meta.v1";
const LOCAL_INSTANCE_ID_KEY = "pocketLite.instanceId.v1";
const UNSAVED_CLOSE_MESSAGE = "You have local changes not backed up yet.";
const state = {
  nodes: [],
  tombstones: [],
  rootExtras: {},
  dataExtras: {},
  selectedId: "",
  focusRootId: "",
  collapsed: new Set(),
  urgentCollectorExpanded: false,
  ops: [],
  source: {
    schema: "",
    fileName: "",
    writtenAt: "",
  },
  inlineEdit: {
    id: "",
    isNew: false,
    originalLabel: "",
    afterId: "",
    parentId: "",
    autoFocus: false,
  },
  moveMode: false,
  detailsEdit: {
    id: "",
    originalLabel: "",
    originalDetails: "",
    originalUrgent: false,
    originalCopyContext: false,
    draftOpRecorded: false,
    opsStartLength: 0,
  },
  typeJump: {
    query: "",
    cycle: 0,
    lastAt: 0,
  },
  saveInProgress: false,
  commandPaletteOpen: false,
  rowMiniMenuOpen: false,
  rowMiniMenuNodeId: "",
  captureRhythm: {
    parentId: "",
    lastAddedId: "",
    expiresAt: 0,
  },
  navigationMemory: {
    filterSelectedId: "",
    filterFocusRootId: "",
    preFocusSelectedId: "",
  },
  conflictGuard: {
    active: false,
    reason: "",
    loadedAt: "",
    newerAt: "",
  },
};
let titleToastTimer = null;
let saveChipTimer = null;
let importRevealTimer = null;
let moveModeIdleTimer = null;
let movePadRepeatStartTimer = null;
let movePadRepeatInterval = null;
let pendingCopyClickTimer = null;
const COPY_CLICK_DELAY_MS = 190;
let statusActionHandler = null;
let lastDeleteUndoSnapshot = null;
let lastMoveUndoSnapshot = null;
let lastEditUndoSnapshot = null;
let lastTreeUndoKind = "";
let pendingDeleteConfirmNodeId = "";
let pendingDeleteConfirmExpiresAt = 0;
const TREE_DELETE_CONFIRM_WINDOW_MS = 12000;
const rowCopyToastTimers = new Map();
const rowTouchFlashTimers = new Map();
let lastSavedLabel = "";
let truthFileHandle = null;
let exportTreeQueue = Promise.resolve();
let pendingStaleExportConfirmExpiresAt = 0;
let lastPathExtractMeta = {
  strictAbsoluteMode: false,
  ignoredNonAbsoluteCount: 0,
  nonEmptyPrepared: 0,
  absolutePrepared: 0,
  extractedCount: 0,
  source: "none",
  parseError: "",
};
let pendingPathImport = null;

const el = {
  btnUnfoldAll: document.getElementById("btnUnfoldAll"),
  btnAddPrimary: document.getElementById("btnAddPrimary"),
  btnMovePrimary: document.getElementById("btnMovePrimary"),
  btnRenamePrimary: document.getElementById("btnRenamePrimary"),
  btnDeletePrimary: document.getElementById("btnDeletePrimary"),
  btnOpenPrimary: document.getElementById("btnOpenPrimary"),
  btnLoad: document.getElementById("btnLoad"),
  btnPip: document.getElementById("btnPip"),
  btnImportNow: document.getElementById("btnImportNow"),
  btnCancelImport: document.getElementById("btnCancelImport"),
  btnUndoImport: document.getElementById("btnUndoImport"),
  btnExportTree: document.getElementById("btnExportTree"),
  btnAddMobile: document.getElementById("btnAddMobile"),
  btnMovePadUp: document.getElementById("btnMovePadUp"),
  btnMovePadDown: document.getElementById("btnMovePadDown"),
  btnMovePadLeft: document.getElementById("btnMovePadLeft"),
  btnMovePadRight: document.getElementById("btnMovePadRight"),
  fileInput: document.getElementById("fileInput"),
  titleToast: document.getElementById("titleToast"),
  search: document.getElementById("search"),
  focusPath: document.getElementById("focusPath"),
  modePill: document.getElementById("modePill"),
  treeWrap: document.getElementById("treeWrap"),
  treeRoot: document.getElementById("treeRoot"),
  commandOverlay: document.getElementById("commandOverlay"),
  controlsOverlay: document.getElementById("controlsOverlay"),
  btnControlsClose: document.getElementById("btnControlsClose"),
  cmdAddChild: document.getElementById("cmdAddChild"),
  cmdAddSibling: document.getElementById("cmdAddSibling"),
  cmdRename: document.getElementById("cmdRename"),
  cmdEdit: document.getElementById("cmdEdit"),
  cmdMove: document.getElementById("cmdMove"),
  cmdFocus: document.getElementById("cmdFocus"),
  cmdSearch: document.getElementById("cmdSearch"),
  cmdSave: document.getElementById("cmdSave"),
  cmdHealth: document.getElementById("cmdHealth"),
  cmdRestoreRecent: document.getElementById("cmdRestoreRecent"),
  cmdHelp: document.getElementById("cmdHelp"),
  detailOverlay: document.getElementById("detailOverlay"),
  detailEditorTitle: document.getElementById("detailEditorTitle"),
  detailEditorPath: document.getElementById("detailEditorPath"),
  detailEditorLabel: document.getElementById("detailEditorLabel"),
  detailEditorBody: document.getElementById("detailEditorBody"),
  detailEditorUrgent: document.getElementById("detailEditorUrgent"),
  detailEditorCopyContext: document.getElementById("detailEditorCopyContext"),
  btnDetailSave: document.getElementById("btnDetailSave"),
  btnDetailCancel: document.getElementById("btnDetailCancel"),
};
