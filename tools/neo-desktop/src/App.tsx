import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useState, useEffect, useRef } from "react";
import { Settings, User, Bot, Send, Loader2, Trash2, FileText, ChevronRight, ChevronDown, Folder, File as FileIcon, Edit3, Save, ArrowLeft, PanelLeft, PanelRight, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
// @ts-ignore
import wikiLinkPlugin from "remark-wiki-link";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import "./App.css";

const ResizeHandle = () => (
  <PanelResizeHandle className="w-1.5 bg-gray-100/50 hover:bg-gray-200 transition-colors cursor-col-resize active:bg-gray-300 flex flex-col justify-center items-center">
    <div className="h-8 w-1 bg-gray-300 rounded-full" />
  </PanelResizeHandle>
);

function FileTreeInput({
  initialValue,
  type,
  depth = 0,
  onSubmit,
  onCancel
}: {
  initialValue: string;
  type: 'rename' | 'new_file' | 'new_folder';
  depth?: number;
  onSubmit: (val: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const isCanceled = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    if (type !== 'new_folder' && val.endsWith('.md')) {
      inputRef.current?.setSelectionRange(0, val.length - 3);
    } else {
      inputRef.current?.select();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (val.trim()) {
        onSubmit(val.trim());
      } else {
        isCanceled.current = true;
        onCancel();
      }
    } else if (e.key === 'Escape') {
      isCanceled.current = true;
      onCancel();
    }
  };

  const handleBlur = () => {
    if (!isCanceled.current) {
      if (val.trim()) {
        onSubmit(val.trim());
      } else {
        onCancel();
      }
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 py-1.5 pr-3 text-sm bg-blue-50/50"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="w-4 flex-shrink-0" />
      {type === 'new_folder' ? (
        <Folder size={14} className="flex-shrink-0 text-blue-500" />
      ) : (
        <FileIcon size={14} className="flex-shrink-0 text-gray-400" />
      )}
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="flex-1 bg-white border border-blue-400 rounded px-1 text-sm outline-none w-full shadow-sm"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function FileTreeItem({
  node,
  depth = 0,
  selectedPath,
  onSelectFile,
  onContextMenu,
  refreshTrigger,
  editAction,
  onEditSubmit,
  onEditCancel,
  onDropNode
}: {
  node: { name: string, path: string, is_dir: boolean };
  depth?: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, node: { name: string, path: string, is_dir: boolean }) => void;
  refreshTrigger?: number;
  editAction?: { id: string, type: 'rename' | 'new_file' | 'new_folder', path: string, initialValue: string } | null;
  onEditSubmit?: (val: string, action: any) => void;
  onEditCancel?: () => void;
  onDropNode?: (sourcePath: string, targetPath: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<{ name: string, path: string, is_dir: boolean }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const isSelected = selectedPath === node.path;

  const loadChildren = async () => {
    setIsLoading(true);
    try {
      const nodes: any = await invoke("list_directory", { relativePath: node.path });
      setChildren(nodes);
    } catch (e) {
      console.error("Failed to load directory", node.path, e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isExpanded && node.is_dir) {
      loadChildren();
    }
  }, [refreshTrigger, node.path]);

  useEffect(() => {
    if (editAction && editAction.path === node.path && node.is_dir && !isExpanded) {
      if (children.length === 0) {
        loadChildren().then(() => setIsExpanded(true));
      } else {
        setIsExpanded(true);
      }
    }
  }, [editAction, node.path, node.is_dir]);

  if (editAction?.type === 'rename' && editAction.path === node.path) {
    return (
      <FileTreeInput
        type="rename"
        initialValue={editAction.initialValue}
        depth={depth}
        onSubmit={(val) => onEditSubmit && onEditSubmit(val, editAction)}
        onCancel={() => onEditCancel && onEditCancel()}
      />
    );
  }

  const handleClick = async () => {
    if (node.is_dir) {
      if (!isExpanded && children.length === 0) {
        await loadChildren();
      }
      setIsExpanded(!isExpanded);
    } else {
      onSelectFile(node.path);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (node.is_dir) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    if (node.is_dir) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (node.is_dir) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const sourcePath = e.dataTransfer.getData("text/plain");
      if (sourcePath && onDropNode) {
        onDropNode(sourcePath, node.path);
      }
    }
  };

  return (
    <div>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu && onContextMenu(e, node); }}
        className={`flex items-center gap-1.5 py-1.5 pr-3 cursor-pointer select-none text-sm group transition-colors 
          ${isSelected && !node.is_dir ? "bg-black text-white" : "hover:bg-gray-200 text-gray-700"}
          ${isDragOver ? "bg-blue-100 ring-2 ring-blue-400 ring-inset" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={node.name}
      >
        {node.is_dir ? (
          <span className="opacity-50 group-hover:opacity-100 flex-shrink-0 w-4 flex justify-center">
            {isLoading ? <Loader2 size={12} className="animate-spin" /> :
              isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span className="w-4 flex-shrink-0" /> // Spacer for alignment
        )}

        {node.is_dir ? (
          <Folder size={14} className={`flex-shrink-0 ${isSelected ? "text-gray-300" : "text-blue-500"}`} />
        ) : (
          <FileIcon size={14} className={`flex-shrink-0 ${isSelected ? "text-gray-300" : "text-gray-400"}`} />
        )}
        <span className="truncate leading-tight">{node.name}</span>
      </div>

      {isExpanded && node.is_dir && (children.length > 0 || (editAction && editAction.path === node.path)) && (
        <div className="flex flex-col">
          {editAction && (editAction.type === 'new_file' || editAction.type === 'new_folder') && editAction.path === node.path && (
            <FileTreeInput
              key={editAction.id}
              type={editAction.type}
              initialValue={editAction.initialValue}
              depth={depth + 1}
              onSubmit={(val) => onEditSubmit && onEditSubmit(val, editAction)}
              onCancel={() => onEditCancel && onEditCancel()}
            />
          )}
          {children.map(child => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onContextMenu={onContextMenu}
              refreshTrigger={refreshTrigger}
              editAction={editAction}
              onEditSubmit={onEditSubmit}
              onEditCancel={onEditCancel}
              onDropNode={onDropNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AppConfig {
  vault_path: string;
  gemini_api_key: string;
}
function App() {
  const { t, i18n } = useTranslation();
  const [vaultPath, setVaultPath] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isReady, setIsReady] = useState(false);

  // Chat States
  const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [chatSession, setChatSession] = useState<any>(null);
  const [initError, setInitError] = useState<string | null>(null);

  // UI States
  const [activeTab, setActiveTab] = useState<"workspace" | "settings">("workspace");

  // File Explorer & Editor States
  const [rootNodes, setRootNodes] = useState<{ name: string, path: string, is_dir: boolean }[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [editAction, setEditAction] = useState<{
    id: string;
    type: 'rename' | 'new_file' | 'new_folder';
    path: string;
    initialValue: string;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileHistory, setFileHistory] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<string>("");
  const [editorMode, setEditorMode] = useState<"view" | "edit">("view");

  const [showExplorer, setShowExplorer] = useState(true);
  const [showAssistant, setShowAssistant] = useState(true);

  // Context Menu States
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, node: { name: string, path: string, is_dir: boolean } | null } | null>(null);
  const [clipboard, setClipboard] = useState<{ path: string, isCut: boolean } | null>(null);
  const [deleteConfirmNode, setDeleteConfirmNode] = useState<{ name: string, path: string, is_dir: boolean } | null>(null);

  useEffect(() => {
    // Unused
  }, []);

  const handleContextMenu = async (e: React.MouseEvent, node: { name: string, path: string, is_dir: boolean } | null) => {
    e.preventDefault();
    setContextMenu({ x: e.pageX, y: e.pageY, node });

    try {
      const items = [];
      const newFileItem = await MenuItem.new({ text: t("new_file"), action: () => handleNewFile(node) });
      const newFolderItem = await MenuItem.new({ text: t("new_folder"), action: () => handleNewFolder(node) });

      items.push(newFileItem, newFolderItem);

      if (node) {
        items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        const cutItem = await MenuItem.new({ text: t("cut"), action: () => handleCut(node) });
        const copyItem = await MenuItem.new({ text: t("copy"), action: () => handleCopy(node) });
        items.push(cutItem, copyItem);

        items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        const renameItem = await MenuItem.new({ text: t("rename"), action: () => handleRename(node) });
        items.push(renameItem);
      }

      // Check if we have anything in state clipboard right now
      // Note: we might want to pass clipboard state via a ref if it's stale in closure, 
      // but for now context menu is built on click so it captures current state
      const pasteItem = await MenuItem.new({ text: t("paste"), enabled: !!clipboard, action: () => handlePaste(node) });
      items.push(pasteItem);

      if (node) {
        items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        const deleteItem = await MenuItem.new({ text: t("delete"), action: () => handleDelete(node) });
        items.push(deleteItem);
      }

      const menu = await Menu.new({ items });
      await menu.popup();
    } catch (err) {
      console.error("Failed to create native menu:", err);
    }
  };

  const handleNewFile = (menuNode?: { name: string, path: string, is_dir: boolean } | null) => {
    const targetNode = menuNode || contextMenu?.node;
    const parentPath = targetNode ? (targetNode.is_dir ? targetNode.path : targetNode.path.substring(0, targetNode.path.lastIndexOf('/'))) : "";
    setEditAction({
      id: Date.now().toString(),
      type: 'new_file',
      path: parentPath,
      initialValue: ""
    });
    setContextMenu(null);
  };

  const handleNewFolder = (menuNode?: { name: string, path: string, is_dir: boolean } | null) => {
    const targetNode = menuNode || contextMenu?.node;
    const parentPath = targetNode ? (targetNode.is_dir ? targetNode.path : targetNode.path.substring(0, targetNode.path.lastIndexOf('/'))) : "";
    setEditAction({
      id: Date.now().toString(),
      type: 'new_folder',
      path: parentPath,
      initialValue: ""
    });
    setContextMenu(null);
  };

  const handleCut = (menuNode?: { name: string, path: string, is_dir: boolean } | null) => {
    const targetNode = menuNode || contextMenu?.node;
    if (targetNode) setClipboard({ path: targetNode.path, isCut: true });
    setContextMenu(null);
  };

  const handleCopy = (menuNode?: { name: string, path: string, is_dir: boolean } | null) => {
    const targetNode = menuNode || contextMenu?.node;
    if (targetNode) setClipboard({ path: targetNode.path, isCut: false });
    setContextMenu(null);
  };

  const handlePaste = async (menuNode?: { name: string, path: string, is_dir: boolean } | null) => {
    if (!clipboard) return;
    const targetNode = menuNode || contextMenu?.node;
    const parentPath = targetNode ? (targetNode.is_dir ? targetNode.path : targetNode.path.substring(0, targetNode.path.lastIndexOf('/'))) : "";
    const itemName = clipboard.path.split('/').pop() || "";
    const targetPath = parentPath ? `${parentPath}/${itemName}` : itemName;

    try {
      if (clipboard.isCut) {
        await invoke("move_path", { fromPath: clipboard.path, toPath: targetPath });
        setClipboard(null);
      } else {
        await invoke("copy_path", { fromPath: clipboard.path, toPath: targetPath });
      }
      loadRootFiles();
    } catch (e) { alert(e); }
    setContextMenu(null);
  };

  const handleRename = (menuNode?: { name: string, path: string, is_dir: boolean } | null) => {
    const targetNode = menuNode || contextMenu?.node;
    if (!targetNode) return;
    setEditAction({
      id: Date.now().toString(),
      type: 'rename',
      path: targetNode.path,
      initialValue: targetNode.name
    });
    setContextMenu(null);
  };

  const handleDropNode = async (sourcePath: string, targetDirPath: string | null) => {
    if (sourcePath === targetDirPath) return;

    // Prevent dragging a folder into itself or its own subdirectories
    if (targetDirPath && targetDirPath.startsWith(sourcePath + '/')) {
      alert(t("cannot_move_into_self") || "Cannot move a folder into itself or its subdirectories");
      return;
    }

    const itemName = sourcePath.split('/').pop() || "";
    const targetPath = targetDirPath ? `${targetDirPath}/${itemName}` : itemName;

    if (sourcePath === targetPath) return;

    try {
      await invoke("move_path", { fromPath: sourcePath, toPath: targetPath });
      if (selectedFile === sourcePath) setSelectedFile(targetPath);
      loadRootFiles();
    } catch (e) {
      alert(`Error moving file: ${e}`);
    }
  };

  const handleEditSubmit = async (val: string, action: any) => {
    const parentPath = action.type === 'rename'
      ? action.path.substring(0, action.path.lastIndexOf('/'))
      : action.path; // for new_file/folder, action.path is parentPath

    if (action.type === 'rename') {
      if (val === action.initialValue) {
        setEditAction(null);
        return;
      }
      const isDir = !action.initialValue.endsWith('.md');
      const targetName = isDir ? val : (val.endsWith('.md') ? val : `${val}.md`);
      const targetPath = parentPath ? `${parentPath}/${targetName}` : targetName;

      try {
        await invoke("move_path", { fromPath: action.path, toPath: targetPath });
        if (selectedFile === action.path) setSelectedFile(targetPath);
        setEditAction(null);
        loadRootFiles();
      } catch (e) { alert(`Error renaming: ${e}`); setEditAction(null); }
    } else if (action.type === 'new_file') {
      const fileName = val.endsWith('.md') ? val : `${val}.md`;
      const fullPath = action.path ? `${action.path}/${fileName}` : fileName;
      try {
        await invoke("write_markdown_file", { relativePath: fullPath, content: "" });
        setEditAction(null);
        loadRootFiles();
        handleSelectFile(fullPath);
      } catch (e) { alert(`Error creating file: ${e}`); setEditAction(null); }
    } else if (action.type === 'new_folder') {
      const fullPath = action.path ? `${action.path}/${val}` : val;
      try {
        await invoke("create_directory", { relativePath: fullPath });
        setEditAction(null);
        loadRootFiles();
      } catch (e) { alert(`Error creating folder: ${e}`); setEditAction(null); }
    }
  };

  const handleDelete = (menuNode?: { name: string, path: string, is_dir: boolean } | null) => {
    const targetNode = menuNode || contextMenu?.node;
    if (!targetNode) return;
    setDeleteConfirmNode(targetNode);
    setContextMenu(null);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmNode) return;
    try {
      await invoke("delete_path", { relativePath: deleteConfirmNode.path });
      if (selectedFile === deleteConfirmNode.path) {
        setSelectedFile(null);
        setFileContent("");
      }
      loadRootFiles();
    } catch (e) { alert(e); }
    setDeleteConfirmNode(null);
  };

  useEffect(() => {
    async function loadConfig() {
      try {
        const config: AppConfig = await invoke("get_config");
        setVaultPath(config.vault_path);
        setApiKey(config.gemini_api_key);

        if (config.vault_path && config.gemini_api_key) {
          initGemini();
        } else {
          setActiveTab("settings");
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      }
    }
    loadConfig();
  }, []);

  const loadRootFiles = async () => {
    try {
      const nodes: any = await invoke("list_directory", { relativePath: null });
      setRootNodes(nodes);
      setRefreshTrigger(prev => prev + 1);
    } catch (e) {
      console.error("Failed to load root directory:", e);
    }
  };

  // Load root directory when vault is ready
  useEffect(() => {
    if (isReady && vaultPath) {
      loadRootFiles();
    }
  }, [isReady, vaultPath]);

  const handleSelectFile = async (path: string, saveToHistory: boolean = true) => {
    if (saveToHistory && selectedFile && selectedFile !== path) {
      setFileHistory(prev => [...prev, selectedFile]);
    }

    setSelectedFile(path);
    setEditorMode("view");
    try {
      const content: string = await invoke("read_markdown_file", { relativePath: path });
      setFileContent(content);
    } catch (e) {
      console.error("Failed to read file", e);
      setFileContent(`Error loading file: ${e}`);
    }
  };

  const handleGoBack = () => {
    if (fileHistory.length === 0) return;
    const prevFile = fileHistory[fileHistory.length - 1];
    setFileHistory(prev => prev.slice(0, -1));
    handleSelectFile(prevFile, false);
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    try {
      await invoke("write_markdown_file", { relativePath: selectedFile, content: fileContent });
      setEditorMode("view");
    } catch (e) {
      alert(`Failed to save file: ${e}`);
    }
  };

  const handleWikiLinkClick = async (permalink: string) => {
    try {
      let queryName = permalink;
      if (queryName.includes("/")) {
        queryName = queryName.split("/").pop() || queryName;
      }
      if (!queryName.endsWith(".md")) {
        queryName += ".md";
      }

      const res: any = await invoke("search_files", { query: queryName });
      let finalPath = permalink.endsWith(".md") ? permalink : `${permalink}.md`;

      if (res && res.matches && res.matches.length > 0) {
        const exact = res.matches.find((p: string) => p.endsWith(queryName));
        finalPath = exact || res.matches[0];
      }

      handleSelectFile(finalPath);
    } catch (e) {
      console.error("Failed to navigate to wiki link", e);
    }
  };

  const wikiLinkOptions = {
    hrefTemplate: (permalink: string) => `#wiki:${permalink}`,
    pageResolver: (name: string) => [name]
  };

  const markdownComponents = {
    a: ({ href, children, ...props }: any) => {
      if (href && href.startsWith("#wiki:")) {
        const permaLink = decodeURIComponent(href.replace("#wiki:", ""));
        return (
          <span
            className="text-blue-500 cursor-pointer hover:underline font-medium"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleWikiLinkClick(permaLink);
            }}
            title={permaLink}
          >
            {children}
          </span>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" {...props}>{children}</a>;
    }
  };

  const initGemini = async () => {
    try {
      setInitError(null);
      // Load history
      const historyRes: any = await invoke("load_chat_history").catch((e) => {
        console.warn("Failed to load history:", e);
        return { messages: [] };
      });
      const pastMessages = historyRes.messages || [];

      setChatSession(true); // Flag to say AI is ready
      setMessages(pastMessages.map((m: any) => ({ role: m.role, text: m.content || "" })));
    } catch (err: any) {
      console.error("Failed init gemini:", err);
      setInitError(err.message || err.toString());
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    if (!chatSession) {
      console.error("Cannot send message: AI is not initialized");
      alert("AI is not initialized properly. Please check API key and restart.");
      return;
    }

    const userMsg = inputValue;
    setInputValue("");
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setIsTyping(true);

    const promptContext = selectedFile
      ? `\n\n[System Context: The user is currently viewing/editing the file: ${selectedFile} in their editor. You may refer to it.]`
      : "";
    const finalPrompt = userMsg + promptContext;

    try {
      let responseText = "";

      // Format history
      const formattedHistory = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      if (userMsg.trim().startsWith("/skill ")) {
        const parts = userMsg.trim().split(" ");
        const skillName = parts[1];
        const args = parts.slice(2);
        responseText = await invoke("run_skill", { skillName, args });
      } else {
        responseText = await invoke("chat", { prompt: finalPrompt, history: formattedHistory });
      }

      setMessages(prev => [...prev, { role: "model", text: responseText }]);

      // Save history incrementally
      const storableHistory = [...messages, { role: "user", text: finalPrompt }, { role: "model", text: responseText }].map(m => ({
        role: m.role,
        content: m.text
      }));
      await invoke("save_chat_history", { history: { messages: storableHistory } }).catch(console.error);

    } catch (error: any) {
      setMessages(prev => [...prev, { role: "model", text: `Error: ${error.message || error.toString()}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleClearChat = async () => {
    try {
      await invoke("clear_chat_history");
      setMessages([]);
      if (apiKey) {
        initGemini(); // Re-initialize a blank session
      }
    } catch (e) {
      alert(`Failed to clear history: ${e}`);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await invoke("save_config", { vaultPath: vaultPath, geminiApiKey: apiKey });
      setIsReady(true);
      setActiveTab("workspace");
    } catch (error) {
      alert(`Failed to save config: ${error}`);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f9fafb]">
      {/* Sidebar */}
      <div className="w-16 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col items-center py-6 gap-6 z-10">
        <div className="w-10 h-10 bg-black rounded-xl shadow-lg flex items-center justify-center">
          <span className="text-white font-bold text-xl">N</span>
        </div>

        <div className="flex flex-col gap-4 mt-8 flex-1">
          <button
            onClick={() => setActiveTab("workspace")}
            className={`p-3 rounded-xl transition-all ${activeTab === "workspace" ? "bg-black text-white shadow-md" : "text-gray-500 hover:bg-gray-100"}`}
            title="Workspace"
          >
            <FileText size={20} />
          </button>
        </div>

        <button
          onClick={() => setActiveTab("settings")}
          className={`p-3 rounded-xl transition-all ${activeTab === "settings" ? "bg-black text-white shadow-md" : "text-gray-500 hover:bg-gray-100"}`}
          title="Settings"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {activeTab === "settings" && (
          <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 max-w-md w-full">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Settings className="text-gray-400" /> {t("system_config")}
              </h2>

              <div className="flex gap-2 mb-6">
                <button
                  onClick={() => i18n.changeLanguage('zh')}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${i18n.language === 'zh' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  简体中文
                </button>
                <button
                  onClick={() => i18n.changeLanguage('en')}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${i18n.language === 'en' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  English
                </button>
              </div>

              <form onSubmit={handleSaveConfig} className="flex flex-col gap-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">{t("local_vault_path")}</label>
                  <p className="text-xs text-gray-400 mb-2">{t("local_vault_desc")}</p>
                  <input
                    type="text"
                    value={vaultPath}
                    onChange={e => setVaultPath(e.target.value)}
                    placeholder="/Users/username/mox/neo"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">{t("gemini_api_key")}</label>
                  <p className="text-xs text-gray-400 mb-2">{t("gemini_api_desc")}</p>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black outline-none transition-all"
                  />
                </div>

                <button
                  type="submit"
                  className="mt-4 w-full bg-black text-white font-semibold py-3 rounded-xl hover:bg-gray-800 transition-colors shadow-md active:scale-[0.98]"
                >
                  {t("save_config")}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === "workspace" && (
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            <div data-tauri-drag-region className="h-10 border-b border-gray-100 flex items-center justify-between px-4 bg-gray-50/50 select-none">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">{t("workspace")}</span>
              </div>

              {/* Command Center - Search Bar */}
              <div className="flex-1 max-w-md px-12">
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-black transition-colors">
                    <Search size={14} />
                  </div>
                  <input
                    type="text"
                    placeholder={t("search_placeholder")}
                    className="w-full bg-white/50 border border-gray-200 rounded-lg py-1 pl-9 pr-3 text-xs focus:bg-white focus:border-gray-300 outline-none transition-all shadow-sm placeholder:text-gray-400"
                  />
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowExplorer(!showExplorer)}
                  className={`p-1.5 rounded-lg transition-colors ${showExplorer ? 'text-gray-800 bg-gray-200/50' : 'text-gray-400 hover:bg-gray-100'}`}
                  title={t("toggle_explorer")}
                >
                  <PanelLeft size={16} />
                </button>
                <button
                  onClick={() => setShowAssistant(!showAssistant)}
                  className={`p-1.5 rounded-lg transition-colors ${showAssistant ? 'text-gray-800 bg-gray-200/50' : 'text-gray-400 hover:bg-gray-100'}`}
                  title={t("toggle_assistant")}
                >
                  <PanelRight size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {!isReady ? (
                <div className="flex flex-col items-center justify-center w-full text-center p-8">
                  <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mb-4">
                    <Settings size={32} />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{t("setup_required")}</h3>
                  <p className="text-gray-500 max-w-sm mb-6">{t("setup_desc")}</p>
                  <button
                    onClick={() => setActiveTab("settings")}
                    className="px-6 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors shadow-sm"
                  >
                    {t("go_to_settings")}
                  </button>
                </div>
              ) : (
                <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
                  {/* Left Pane: File Explorer */}
                  {showExplorer && (
                    <Panel defaultSize={20} minSize={15} className="flex flex-col bg-gray-50/50">
                      <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-gray-700">
                          <Folder size={16} />
                          <span className="font-semibold text-xs tracking-wide uppercase">{t("vault_explorer")}</span>
                        </div>
                      </div>
                      <div
                        className="flex-1 overflow-y-auto py-2"
                        onContextMenu={(e) => handleContextMenu(e, null)}
                        onClick={() => { if (editAction) setEditAction(null); }}
                      >
                        {editAction && (editAction.type === 'new_file' || editAction.type === 'new_folder') && editAction.path === "" && (
                          <FileTreeInput
                            key={editAction.id}
                            type={editAction.type}
                            initialValue={editAction.initialValue}
                            depth={0}
                            onSubmit={(val) => handleEditSubmit(val, editAction)}
                            onCancel={() => setEditAction(null)}
                          />
                        )}
                        {rootNodes.map(node => (
                          <FileTreeItem
                            key={node.path}
                            node={node}
                            selectedPath={selectedFile}
                            onSelectFile={handleSelectFile}
                            onContextMenu={handleContextMenu}
                            refreshTrigger={refreshTrigger}
                            editAction={editAction}
                            onEditSubmit={handleEditSubmit}
                            onEditCancel={() => setEditAction(null)}
                            onDropNode={handleDropNode}
                          />
                        ))}
                      </div>

                      {/* Root Drop Zone Padding */}
                      <div
                        className="flex-1 min-h-[100px]"
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const sourcePath = e.dataTransfer.getData("text/plain");
                          if (sourcePath) {
                            handleDropNode(sourcePath, null);
                          }
                        }}
                        onContextMenu={(e) => handleContextMenu(e, null)}
                      />
                    </Panel>
                  )}

                  {showExplorer && <ResizeHandle />}

                  {/* Middle Pane: Editor / Viewer */}
                  <Panel defaultSize={showExplorer && showAssistant ? 50 : 80} minSize={30} className="flex flex-col overflow-hidden bg-white">
                    <div className="h-12 border-b border-gray-100 flex items-center justify-between px-4 bg-white z-10 shadow-sm text-sm">
                      <div className="flex items-center gap-2 text-gray-500">
                        {selectedFile ? (
                          <>
                            <button
                              onClick={handleGoBack}
                              disabled={fileHistory.length === 0}
                              className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${fileHistory.length > 0 ? "hover:bg-gray-100 text-gray-700 cursor-pointer" : "opacity-30 cursor-not-allowed"}`}
                              title={t("go_back")}
                            >
                              <ArrowLeft size={16} />
                            </button>
                            <FileIcon size={16} className="ml-1" />
                            <span className="truncate max-w-[200px] lg:max-w-[300px]">{selectedFile}</span>
                          </>
                        ) : (
                          <span className="text-gray-400 font-medium px-2">Neo Desktop</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedFile && (
                          editorMode === "view" ? (
                            <button
                              onClick={() => setEditorMode("edit")}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-black rounded-lg transition-colors"
                            >
                              <Edit3 size={14} /> {t("edit")}
                            </button>
                          ) : (
                            <button
                              onClick={handleSaveFile}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-black text-white hover:bg-gray-800 rounded-lg transition-colors"
                            >
                              <Save size={14} /> {t("save")}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-8 relative">
                      {selectedFile ? (
                        editorMode === "view" ? (
                          <div className="max-w-3xl mx-auto prose prose-sm md:prose-base prose-slate">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm, [wikiLinkPlugin, wikiLinkOptions]]}
                              components={markdownComponents}
                            >
                              {fileContent}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <textarea
                            value={fileContent}
                            onChange={(e) => setFileContent(e.target.value)}
                            className="w-full h-full min-h-[500px] resize-none outline-none font-mono text-sm leading-relaxed text-gray-800 bg-transparent"
                            spellCheck={false}
                          />
                        )
                      ) : (
                        <div className="flex-1 h-full flex flex-col items-center justify-center text-gray-400 mt-20">
                          <FileText size={48} className="opacity-20 mb-4" />
                          <p>{t("select_markdown")}</p>
                        </div>
                      )}
                    </div>
                  </Panel>

                  {showAssistant && <ResizeHandle />}

                  {/* Right Pane: AI Chat */}
                  {showAssistant && (
                    <Panel defaultSize={30} minSize={20} className="flex flex-col bg-gray-50/30">
                      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                        <h2 className="font-bold text-sm flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${chatSession ? 'bg-green-500' : initError ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`}></div>
                          {t("neo_assistant")}
                        </h2>
                        <div className="flex items-center gap-2">
                          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                            {chatSession ? t("ready") : initError ? t("offline") : t("loading")}
                          </div>
                          {chatSession && (
                            <button
                              onClick={handleClearChat}
                              className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              title={t("clear_memory")}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {initError && (
                        <div className="bg-red-50 text-red-600 p-3 m-3 rounded-lg text-xs border border-red-100 flex flex-col gap-1">
                          <strong className="font-bold">Error</strong>
                          <span>{initError}</span>
                        </div>
                      )}

                      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                        {messages.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2 p-6 text-center">
                            <Bot size={32} className="opacity-20" />
                            <p className="text-sm">{t("hi_ready")}</p>
                          </div>
                        ) : (
                          messages.map((msg, i) => (
                            <div key={i} className={`flex gap-2 max-w-[90%] ${msg.role === 'user' ? 'self-end flex-row-reverse' : 'self-start'}`}>
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${msg.role === 'user' ? 'bg-gray-200 text-gray-600' : 'bg-black text-white'}`}>
                                {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                              </div>
                              <div className={`px-4 py-2.5 rounded-2xl text-sm ${msg.role === 'user'
                                ? 'bg-black text-white rounded-tr-sm shadow-sm whitespace-pre-wrap'
                                : msg.text.startsWith('>')
                                  ? 'bg-blue-50 text-blue-700 border border-blue-100 italic rounded-tl-sm whitespace-pre-wrap'
                                  : 'bg-white border text-gray-800 rounded-tl-sm shadow-sm prose prose-sm max-w-none'
                                }`}>
                                {msg.role === 'user' || msg.text.startsWith('>') ? (
                                  msg.text
                                ) : (
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm, [wikiLinkPlugin, wikiLinkOptions]]}
                                    components={markdownComponents}
                                  >
                                    {msg.text}
                                  </ReactMarkdown>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                        {isTyping && (
                          <div className="flex gap-2 max-w-[90%] self-start items-center">
                            <div className="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center flex-shrink-0">
                              <Bot size={12} />
                            </div>
                            <div className="px-4 py-2.5 rounded-2xl bg-white border text-gray-400 rounded-tl-sm shadow-sm flex items-center gap-2 text-sm">
                              <Loader2 size={14} className="animate-spin" /> {t("thinking")}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="p-3 bg-white border-t">
                        <div className="relative flex items-end gap-2">
                          <textarea
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey && inputValue.trim() && !isTyping) {
                                e.preventDefault();
                                handleSendMessage();
                              }
                            }}
                            placeholder={!chatSession ? t("initializing") : t("ask_neo")}
                            className="flex-1 pl-4 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-black outline-none transition-all shadow-sm disabled:opacity-50 text-sm min-h-[44px] max-h-[120px] resize-y"
                            disabled={isTyping || !chatSession}
                            rows={1}
                          />
                          <button
                            onClick={handleSendMessage}
                            disabled={isTyping || !inputValue.trim() || !chatSession}
                            className="absolute right-2 bottom-1.5 w-[32px] h-[32px] bg-black text-white rounded-lg flex items-center justify-center hover:bg-gray-800 transition-colors disabled:opacity-50"
                          >
                            <Send size={14} />
                          </button>
                        </div>
                      </div>
                    </Panel>
                  )}
                </PanelGroup>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-xl shadow-2xl w-[360px] overflow-hidden border border-gray-100 flex flex-col">
            <div className="p-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("delete") || "Confirm Deletion"}</h3>
              <p className="text-sm text-gray-500 line-clamp-2">
                {t("delete_confirm")} <strong>'{deleteConfirmNode.name}'</strong>?
              </p>
            </div>
            <div className="flex bg-gray-50 border-t border-gray-100 px-5 py-3 justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmNode(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 active:bg-gray-300 rounded-lg transition-colors cursor-pointer"
              >
                {t("cancel") || "Cancel"}
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-lg transition-colors cursor-pointer shadow-sm"
              >
                {t("delete") || "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
