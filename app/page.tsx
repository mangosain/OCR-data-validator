"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  FolderSearch,
  Upload,
  Download,
  ChevronLeft,
  ChevronRight,
  Trash2,
  CheckSquare,
  Square,
  AlertCircle,
  FileSpreadsheet,
  Menu,
  X,
  Loader2,
} from "lucide-react";

// Helper for Smart Caching: Generates a unique SHA-256 hash based on file contents
const generateHash = async (message) => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

export default function App() {
  // --- STATE MANAGEMENT ---
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [fileHandlesMap, setFileHandlesMap] = useState(new Map());
  const [dataset, setDataset] = useState([]);
  const [visibleUrls, setVisibleUrls] = useState({});
  const [originalFileName, setOriginalFileName] = useState("");

  // UI States
  const [viewMode, setViewMode] = useState("Word Level");
  const [groupByFolder, setGroupByFolder] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Persistent States
  const [exportList, setExportList] = useState({});
  const [corrections, setCorrections] = useState({});

  // Handle window resizing to automatically adjust sidebar visibility on mobile vs desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    // Initialize
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- DYNAMIC SCRIPT LOADING FOR EXCEL ---
  useEffect(() => {
    if (!document.getElementById("exceljs-script")) {
      const script = document.createElement("script");
      script.id = "exceljs-script";
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js";
      script.async = true;
      document.head.appendChild(script);
    }
    if (!document.getElementById("xlsx-script")) {
      const scriptXlsx = document.createElement("script");
      scriptXlsx.id = "xlsx-script";
      scriptXlsx.src =
        "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      scriptXlsx.async = true;
      document.head.appendChild(scriptXlsx);
    }
  }, []);

  // --- LOCAL STORAGE SYNC (SMART CACHING) ---
  useEffect(() => {
    if (workspaceId) {
      localStorage.setItem(
        `ocr_state_${workspaceId}`,
        JSON.stringify({
          exportList,
          corrections,
          page: currentPage,
        }),
      );
    }
  }, [exportList, corrections, currentPage, workspaceId]);

  // --- HTML5 DIRECTORY UPLOAD LOGIC ---
  const handleFolderUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setIsScanning(true);

    try {
      const fileMap = new Map();
      let sourceFile = null;

      for (const file of files) {
        const normalizedPath = file.webkitRelativePath
          .replace(/\\/g, "/")
          .toLowerCase();

        if (
          file.name.endsWith(".tsv") ||
          file.name.endsWith(".txt") ||
          file.name.endsWith(".json")
        ) {
          if (!sourceFile) sourceFile = file;
          fileMap.set(normalizedPath, file);
        } else {
          fileMap.set(normalizedPath, file);
        }
      }

      if (!sourceFile) {
        alert(
          "No suitable source file (.tsv, .txt, .json) found in the selected directory.",
        );
        setIsScanning(false);
        e.target.value = null;
        return;
      }

      const sourceText = await sourceFile.text();
      const sourceFileName = sourceFile.name;

      const fileHash = await generateHash(sourceText);

      setFileHandlesMap(fileMap);
      setOriginalFileName(sourceFileName);

      const getFolderId = (imgPath) => {
        if (imgPath.includes("/") || imgPath.includes("\\")) {
          const pathParts = imgPath.replace(/\\/g, "/").split("/");
          return pathParts.length > 1
            ? pathParts[pathParts.length - 2]
            : "Root";
        }
        const target = imgPath.toLowerCase();
        for (const key of fileMap.keys()) {
          if (key.endsWith("/" + target) || key === target) {
            const pathParts = key.split("/");
            return pathParts.length > 1
              ? pathParts[pathParts.length - 2]
              : "Root";
          }
        }
        return "Root";
      };

      const parsedData = [];

      if (sourceFileName.toLowerCase().endsWith(".json")) {
        try {
          const rawData = JSON.parse(sourceText);
          rawData.forEach((item) => {
            const imgPath = item.image_path?.trim();
            if (imgPath) {
              parsedData.push({
                originalPath: imgPath,
                gt: item.gt?.toString().trim() || "",
                pred: item.pred?.toString().trim() || "",
                folderId: getFolderId(imgPath),
                id: imgPath,
              });
            }
          });
        } catch (e) {
          console.error("JSON parsing error:", e);
          alert(
            "Invalid JSON format. Please ensure it is a valid array of objects.",
          );
          setIsScanning(false);
          e.target.value = null;
          return;
        }
      } else {
        const lines = sourceText.split(/\r?\n/);
        lines.forEach((line) => {
          if (!line.trim()) return;
          const parts = line.split("\t");
          const imgPath = parts[0]?.trim();
          if (imgPath) {
            parsedData.push({
              originalPath: imgPath,
              gt: parts[1]?.trim() || "",
              pred: parts[2]?.trim() || "",
              folderId: getFolderId(imgPath),
              id: imgPath,
            });
          }
        });
      }

      const savedData = localStorage.getItem(`ocr_state_${fileHash}`);
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          setExportList(parsed.exportList || {});
          setCorrections(parsed.corrections || {});
          setCurrentPage(parsed.page || 0);
        } catch (e) {
          console.error("Failed to parse local storage", e);
          setExportList({});
          setCorrections({});
          setCurrentPage(0);
        }
      } else {
        setExportList({});
        setCorrections({});
        setCurrentPage(0);
      }

      setDataset(parsedData);
      setWorkspaceId(fileHash);
      
      // Auto-close sidebar on mobile after successful load
      if (window.innerWidth < 1024) setIsSidebarOpen(false);

    } catch (err) {
      console.error("Error processing directory:", err);
      alert("An error occurred while reading the folder.");
    }

    setIsScanning(false);
    e.target.value = null;
  };

  // --- PAGINATION & GROUPING LOGIC ---
  const uniqueFolders = useMemo(() => {
    return [...new Set(dataset.map((item) => item.folderId))].sort();
  }, [dataset]);

  const { paginatedData, totalPages, navTitle, navSubtext } = useMemo(() => {
    if (dataset.length === 0)
      return { paginatedData: [], totalPages: 1, navTitle: "", navSubtext: "" };

    let currentBatch = [];
    let tPages = 1;
    let title = "";
    let subtext = "";

    if (groupByFolder && uniqueFolders.length > 0) {
      const targetFolder = uniqueFolders[currentPage] || uniqueFolders[0];
      currentBatch = dataset.filter((item) => item.folderId === targetFolder);
      tPages = uniqueFolders.length;
      title = `Directory: ${targetFolder}`;
      subtext = `Displaying ${currentBatch.length} items from this folder. (Total dataset: ${dataset.length})`;
    } else {
      const pageSize = viewMode === "Word Level" ? 30 : 10;
      tPages = Math.ceil(dataset.length / pageSize);
      const safePage = Math.min(currentPage, Math.max(0, tPages - 1));
      const startIdx = safePage * pageSize;
      currentBatch = dataset.slice(startIdx, startIdx + pageSize);
      title = `Segment ${safePage + 1} of ${tPages}`;
      subtext = `Displaying ${startIdx + 1} to ${startIdx + currentBatch.length} of ${dataset.length} items.`;
    }

    return {
      paginatedData: currentBatch,
      totalPages: tPages,
      navTitle: title,
      navSubtext: subtext,
    };
  }, [dataset, currentPage, groupByFolder, viewMode, uniqueFolders]);

  // --- DYNAMIC IMAGE URL GENERATION (Memory Optimization) ---
  useEffect(() => {
    let isActive = true;
    const objectUrls = [];

    const loadImages = async () => {
      const newUrls = {};

      for (const item of paginatedData) {
        let target = item.originalPath
          .replace(/\\/g, "/")
          .replace(/^\.?\//, "")
          .toLowerCase();
        let matchedFile = fileHandlesMap.get(target);

        if (!matchedFile) {
          for (const [key, file] of fileHandlesMap.entries()) {
            if (key.endsWith("/" + target) || key === target) {
              matchedFile = file;
              break;
            }
          }
        }

        if (!matchedFile) {
          const filename = target.split("/").pop();
          for (const [key, file] of fileHandlesMap.entries()) {
            if (key.endsWith("/" + filename) || key === filename) {
              matchedFile = file;
              break;
            }
          }
        }

        if (matchedFile) {
          try {
            const url = URL.createObjectURL(matchedFile);
            newUrls[item.id] = url;
            objectUrls.push(url);
          } catch (e) {
            console.error("Failed to load file:", item.originalPath);
          }
        }
      }

      if (isActive) setVisibleUrls(newUrls);
    };

    if (paginatedData.length > 0) loadImages();

    return () => {
      isActive = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [paginatedData, fileHandlesMap]);

  // --- INTERACTION HANDLERS ---
  const toggleFlag = (item) => {
    setExportList((prev) => {
      const next = { ...prev };
      if (next[item.id]) {
        delete next[item.id];
      } else {
        next[item.id] = {
          Image: item.originalPath.split("/").pop(),
          GT: item.gt,
          Pred: item.pred,
          Path: item.originalPath,
          OriginalFile: originalFileName,
        };
      }
      return next;
    });
  };

  const updateCorrection = (id, val) => {
    setCorrections((prev) => ({ ...prev, [id]: val }));
  };

  const handleClearData = () => {
    if (
      window.confirm(
        "Are you sure you want to clear all saved progress for this specific dataset? This cannot be undone.",
      )
    ) {
      setExportList({});
      setCorrections({});
      setCurrentPage(0);
    }
  };

  // --- EXCEL LOGIC ---
  const exportToExcel = async () => {
    const keys = Object.keys(exportList);
    if (keys.length === 0) {
      alert("No items selected to export.");
      return;
    }

    if (!window.ExcelJS) {
      alert(
        "Excel processing library is still loading. Please try again in a few seconds.",
      );
      return;
    }

    setIsExporting(true);

    try {
      const workbook = new window.ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Flagged Errors");

      worksheet.columns = [
        { header: "Image Preview", key: "preview", width: 25 },
        { header: "Image Name", key: "name", width: 20 },
        { header: "GT", key: "gt", width: 15 },
        { header: "Pred", key: "pred", width: 15 },
        { header: "Corrected", key: "corrected", width: 20 },
        { header: "Image Path", key: "path", width: 40 },
        { header: "Source File", key: "source", width: 20 },
      ];

      worksheet.getRow(1).font = { bold: true };

      let rowIndex = 2; 

      for (const id of keys) {
        const item = exportList[id];

        worksheet.addRow({
          name: item.Image,
          gt: item.GT,
          pred: item.Pred,
          corrected: corrections[id] || "",
          path: item.Path,
          source: item.OriginalFile,
        });

        worksheet.getRow(rowIndex).height = 60;

        let target = item.Path.replace(/\\/g, "/")
          .replace(/^\.?\//, "")
          .toLowerCase();
        let matchedFile = fileHandlesMap.get(target);

        if (!matchedFile) {
          for (const [key, file] of fileHandlesMap.entries()) {
            if (key.endsWith("/" + target) || key === target) {
              matchedFile = file;
              break;
            }
          }
        }

        if (!matchedFile) {
          const filename = target.split("/").pop();
          for (const [key, file] of fileHandlesMap.entries()) {
            if (key.endsWith("/" + filename) || key === filename) {
              matchedFile = file;
              break;
            }
          }
        }

        if (matchedFile) {
          try {
            const arrayBuffer = await matchedFile.arrayBuffer();
            const ext = matchedFile.name.split(".").pop().toLowerCase();
            const validExt = ["jpeg", "png", "gif"].includes(ext)
              ? ext
              : ext === "jpg"
                ? "jpeg"
                : "png";

            const imageId = workbook.addImage({
              buffer: arrayBuffer,
              extension: validExt,
            });

            worksheet.addImage(imageId, {
              tl: { col: 0, row: rowIndex - 1 }, 
              ext: { width: 150, height: 60 },
            });
          } catch (e) {
            console.error("Failed to embed image:", item.Path, e);
          }
        }

        rowIndex++;
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "flagged_errors.xlsx");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export error:", error);
      alert("An error occurred while generating the Excel file.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExcelImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!window.XLSX) {
      alert(
        "Excel import library is still loading. Please try again in a few seconds.",
      );
      return;
    }

    setIsImporting(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = window.XLSX.utils.sheet_to_json(worksheet);

      let syncCount = 0;
      const newExportList = { ...exportList };
      const newCorrections = { ...corrections };

      jsonData.forEach((row) => {
        const path = row["Image Path"];

        if (path) {
          newExportList[path] = {
            Image: row["Image Name"] || path.split("/").pop(),
            GT: row["GT"] || "",
            Pred: row["Pred"] || "",
            Path: path,
            OriginalFile: row["Source File"] || "",
          };

          if (row["Corrected"]) {
            newCorrections[path] = row["Corrected"];
          }
          syncCount++;
        }
      });

      setExportList(newExportList);
      setCorrections(newCorrections);
      alert(`Successfully restored ${syncCount} records from Excel.`);
    } catch (error) {
      console.error("Import error:", error);
      alert("Failed to read the Excel file.");
    } finally {
      setIsImporting(false);
      e.target.value = null;
    }
  };

  // --- RENDER HELPERS ---
  const colsClass =
    viewMode === "Word Level"
      ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
      : "grid-cols-1 md:grid-cols-2";
  const imgBoxHeight = viewMode === "Word Level" ? "h-24" : "h-32";

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      
      {/* MOBILE OVERLAY */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <div
        className={`fixed lg:static inset-y-0 left-0 bg-white border-slate-200 shadow-xl lg:shadow-sm flex flex-col z-50 shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${isSidebarOpen ? "w-80 border-r" : "w-0 border-r-0"}`}
      >
        <div className="w-80 h-full flex flex-col overflow-y-auto">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-start">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
                OCR Validator
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Client-Side SPA Architecture
              </p>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 p-1 rounded-md transition-colors"
              title="Close Sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 flex flex-col gap-8">
            {/* Section: Import */}
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400">
                Workspace:{" "}
                {workspaceId ? (
                  <span className="text-green-600">
                    {originalFileName || "Dataset Loaded"}
                  </span>
                ) : (
                  <span className="text-red-400">Not Selected</span>
                )}
              </h2>
              <label
                className={`w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-3 px-4 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer ${isScanning ? "opacity-70 pointer-events-none" : ""}`}
              >
                {isScanning ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <FolderSearch className="w-5 h-5" />
                )}
                {isScanning
                  ? "Scanning Directory..."
                  : "Select Workspace Folder"}
                <input
                  type="file"
                  webkitdirectory="true"
                  directory="true"
                  multiple
                  onChange={handleFolderUpload}
                  className="hidden"
                />
              </label>
              <p className="text-xs text-red-400 leading-relaxed">
                Select the root folder containing your images and the
                .tsv/.txt/.json source file.
              </p>
            </div>

            {/* Section: Display Configuration */}
            <div
              className={`space-y-4 ${!workspaceId && "opacity-50 pointer-events-none"}`}
            >
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Display Configuration
              </h2>

              <div className="bg-slate-50 p-1 rounded-lg flex border border-slate-200">
                {["Word Level", "Line Level"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`flex-1 text-sm py-2 px-3 rounded-md font-medium transition-colors ${viewMode === mode ? "bg-white shadow-sm text-blue-600 border border-slate-200" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {uniqueFolders.length > 1 && (
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={groupByFolder}
                      onChange={(e) => {
                        setGroupByFolder(e.target.checked);
                        setCurrentPage(0);
                      }}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium">
                      Group by Directory
                    </span>
                  </label>

                  {groupByFolder && (
                    <div className="flex flex-col gap-1.5 transition-all">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        Jump to Directory
                      </label>
                      <select
                        value={uniqueFolders[currentPage] || ""}
                        onChange={(e) => {
                          const idx = uniqueFolders.indexOf(e.target.value);
                          if (idx > -1) setCurrentPage(idx);
                        }}
                        className="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-700"
                      >
                        {uniqueFolders.map((folder) => (
                          <option key={folder} value={folder}>
                            {folder}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="w-full h-px bg-slate-100"></div>

            {/* Section: State & Export */}
            <div
              className={`space-y-4 ${!workspaceId && "opacity-50 pointer-events-none"}`}
            >
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-blue-800">
                    Pending Exports
                  </p>
                  <p className="text-2xl font-black text-blue-900 leading-none mt-1">
                    {Object.keys(exportList).length}
                  </p>
                </div>
                <Download className="w-8 h-8 text-blue-200" />
              </div>

              <div className="space-y-2">
                <label
                  className={`w-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-2.5 px-4 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${isImporting ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  {isImporting ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4" />
                  )}
                  <span className="text-sm">
                    {isImporting ? "Reading File..." : "Restore from Excel"}
                  </span>
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={handleExcelImport}
                    className="hidden"
                    disabled={isImporting}
                  />
                </label>

                <button
                  onClick={handleClearData}
                  className="w-full bg-white border border-red-200 hover:bg-red-50 text-red-600 font-medium py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="text-sm">Clear Storage</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col h-full bg-slate-50/50 relative overflow-hidden">
        {/* Floating Open Sidebar Button */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-4 left-4 z-40 bg-white border border-slate-200 shadow-sm p-2 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-white transition-colors"
            title="Open Sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {!workspaceId ? (
          <div className="m-auto text-center max-w-sm flex flex-col items-center px-4">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6 border border-blue-100">
              <Upload className="w-8 h-8 sm:w-10 sm:h-10 text-blue-500" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-2">
              Awaiting Workspace
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm leading-relaxed">
              Initialize your workspace from the sidebar. Select your dataset's
              root folder to securely process and render images locally.
            </p>
          </div>
        ) : (
          <>
            {/* Top Navigation */}
            <div
              className={`bg-white/80 backdrop-blur-md border-b border-slate-200 p-3 sm:p-4 flex items-center justify-between sticky top-0 z-20 transition-all ${!isSidebarOpen ? "pl-16 pr-4 sm:pr-8" : "px-4 sm:px-8"}`}
            >
              <button
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="flex items-center gap-1 sm:gap-2 px-3 py-2 sm:px-4 rounded-lg font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              >
                <ChevronLeft className="w-5 h-5" /> 
                <span className="hidden sm:inline">Previous</span>
              </button>

              <div className="text-center truncate px-2">
                <h3 className="font-bold text-slate-800 text-sm sm:text-lg truncate">
                  {navTitle}
                </h3>
                <p className="text-[10px] sm:text-xs font-medium text-slate-500 mt-0.5 truncate">
                  {navSubtext}
                </p>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={exportToExcel}
                  disabled={isExporting}
                  className={`bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-5 py-2 rounded-lg font-medium shadow-sm transition-all flex items-center gap-2 ${isExporting ? "opacity-70 cursor-not-allowed" : ""}`}
                >
                  {isExporting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">
                    {isExporting ? "Exporting..." : "Export"}
                  </span>
                </button>
                <button
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  disabled={currentPage >= totalPages - 1}
                  className="flex items-center gap-1 sm:gap-2 px-3 py-2 sm:px-4 rounded-lg font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                >
                  <span className="hidden sm:inline">Next</span> 
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Grid Container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
              <div className={`grid gap-4 sm:gap-6 md:gap-8 ${colsClass}`}>
                {paginatedData.map((item) => {
                  const isFlagged = !!exportList[item.id];
                  const imgUrl = visibleUrls[item.id];

                  return (
                    <div
                      key={item.id}
                      className={`group bg-white rounded-xl sm:rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col ${
                        isFlagged
                          ? "border-blue-400 ring-2 sm:ring-4 ring-blue-50 shadow-md"
                          : "border-slate-200 hover:border-slate-300 hover:shadow-md"
                      }`}
                    >
                      {/* Card Header with Checkbox */}
                      <div
                        className={`px-3 py-2 sm:px-4 sm:py-3 border-b border-slate-100 flex items-center justify-between transition-colors ${isFlagged ? "bg-blue-50" : "bg-white"}`}
                      >
                        <button
                          onClick={() => toggleFlag(item)}
                          className="flex items-center gap-2 sm:gap-2.5 group/btn focus:outline-none"
                        >
                          {isFlagged ? (
                            <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 group-hover/btn:text-slate-600 transition-colors" />
                          )}
                          <span
                            className={`text-xs sm:text-sm font-semibold transition-colors ${isFlagged ? "text-blue-700" : "text-slate-500 group-hover/btn:text-slate-700"}`}
                          >
                            {isFlagged ? "Flagged" : "Select"}
                          </span>
                        </button>
                        <span
                          className="text-[10px] sm:text-xs font-medium text-slate-400 truncate max-w-[40%] pl-2"
                          title={item.originalPath.split("/").pop()}
                        >
                          {item.originalPath.split("/").pop()}
                        </span>
                      </div>

                      {/* Image Bounding Box */}
                      <div
                        className={`w-full bg-slate-50 border-b border-slate-100 p-3 sm:p-4 flex items-center justify-center ${imgBoxHeight}`}
                      >
                        {imgUrl ? (
                          <img
                            src={imgUrl}
                            alt={item.originalPath}
                            className="max-w-full max-h-full object-contain drop-shadow-sm mix-blend-multiply"
                          />
                        ) : (
                          <div className="flex flex-col items-center text-slate-400 gap-1 sm:gap-2">
                            <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 opacity-50" />
                            <span className="text-[10px] sm:text-xs font-medium">
                              Image Not Found
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Content Area */}
                      <div className="p-3 sm:p-5 flex-1 flex flex-col gap-3 sm:gap-4">
                        <div className="space-y-1.5 sm:space-y-2 flex-1">
                          <div className="flex bg-green-50/50 rounded-lg border border-green-100/50 px-2.5 py-1.5 sm:px-3 sm:py-2">
                            <span className="text-[10px] sm:text-xs font-bold text-green-700 w-8 sm:w-10 shrink-0 uppercase tracking-wide">
                              GT
                            </span>
                            <span className="text-xs sm:text-sm font-medium text-green-900 break-all">
                              {item.gt || "-"}
                            </span>
                          </div>
                          <div className="flex bg-red-50/50 rounded-lg border border-red-100/50 px-2.5 py-1.5 sm:px-3 sm:py-2">
                            <span className="text-[10px] sm:text-xs font-bold text-red-700 w-8 sm:w-10 shrink-0 uppercase tracking-wide">
                              Pred
                            </span>
                            <span className="text-xs sm:text-sm font-medium text-red-900 break-all">
                              {item.pred || "-"}
                            </span>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-100">
                          <input
                            type="text"
                            placeholder="Type correction here..."
                            value={corrections[item.id] || ""}
                            onChange={(e) =>
                              updateCorrection(item.id, e.target.value)
                            }
                            className="w-full text-xs sm:text-sm px-3 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all placeholder:text-slate-400"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom padding to ensure last row isn't flush with edge */}
              <div className="h-12 sm:h-16"></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}