import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Upload, CheckCircle, AlertCircle, Loader2, FileSpreadsheet, Image as ImageIcon, Download, ChevronDown, ChevronUp, Sparkles, LayoutDashboard, Play, Pause, FileOutput, AlertTriangle, CheckCircle2, ChevronRight, X, Check, RefreshCw, Edit2, Save, Plus, Trash2, RefreshCcw, Search } from 'lucide-react';
import { saveAs } from 'file-saver';
import { optimizeTitle, type SEOData } from './services/seoService';
import { generateMarketingPoints, type MarketingData } from './services/marketingService';
import { extractFactSheet, type FactSheet } from './services/factSheetService';
import { optimizeAttributes } from './services/attributeService';
import { cleanDescriptions, type CleanedDescriptions } from './services/descriptionService';
import { remasterImage, type RemasteredImage } from './services/imageService';
import { type ProductImageCheckReport, extractImagesFromHtml, checkImageRisk } from './services/imageCheckService';
import { Login } from './auth/Login';
import { auditClientEvent, clearToken, me, taskCreate, taskList, taskUpdate, type User } from './auth/api';
import { AdminPanel } from './auth/AdminPanel';

// --- Utility Functions ---

export function generateFinalHtml(baseHtml: string, title?: string, marketingData?: MarketingData): string {
  if (!baseHtml) return '';
  
  let injectedHtml = '<div class="ali-description-container" style="font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto;">';
  
  if (title) {
    injectedHtml += `\n  <h1 style="font-size: 24px; font-weight: bold; color: #333; margin-bottom: 20px; text-align: center; line-height: 1.4;">${title}</h1>`;
  }
  
  if (marketingData && marketingData.points && marketingData.points.length > 0) {
    injectedHtml += `\n  <ul style="font-size: 16px; color: #666; line-height: 1.6; margin-bottom: 30px; padding-left: 20px;">`;
    marketingData.points.forEach(point => {
      injectedHtml += `\n    <li style="margin-bottom: 10px;"><strong>${point.header}</strong>: ${point.content}</li>`;
    });
    injectedHtml += `\n  </ul>`;
  }
  
  injectedHtml += `\n  <div class="description-body">\n${baseHtml}\n  </div>\n</div>`;
  return injectedHtml;
}

export async function uploadToImgBB(base64Data: string): Promise<string> {
  const apiKey = 'a78bf9a83e8ae661160b69a867b6cc6b';
  
  // Convert to JPG with white background using Canvas
  const jpgBase64 = await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Failed to get canvas context'));
      
      // Fill white background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw image on top
      ctx.drawImage(img, 0, 0);
      
      // Export as JPG
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => reject(new Error('Failed to load image for JPG conversion'));
    img.src = base64Data;
  });

  const base64Image = jpgBase64.split(',')[1];
  
  const formData = new FormData();
  formData.append('image', base64Image);
  
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    throw new Error('Failed to upload to ImgBB');
  }
  
  const data = await response.json();
  return data.data.url;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt >= maxRetries) throw error;
      
      // If it's a 429 error, wait longer
      const isRateLimit = error?.message?.includes('429') || error?.status === 429;
      const baseDelay = isRateLimit ? 2000 : 1000;
      
      await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt - 1)));
    }
  }
  throw new Error('Unreachable');
}

const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxyVRp9lYunJ-Pw0C8MqrVNULKMYHjwTlhUldYSBLkPHDA_SJkuwmwurSbU2oB_87CYXA/exec';

async function postGoogleSheetsWithRetry(
  payload: Record<string, any>,
  maxRetries = 3,
  timeoutMs = 15000
): Promise<{ ok: true; attempts: number; data: any } | { ok: false; attempts: number; error: string }> {
  let lastError = 'Unknown sync error';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(GOOGLE_SHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await res.text();
      let data: any = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (data?.success === false) {
        throw new Error(data?.error || 'Sheets returned success=false');
      }
      return { ok: true, attempts: attempt, data };
    } catch (e: any) {
      lastError = e?.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : String(e?.message || e || 'Sync failed');
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, attempts: maxRetries, error: lastError };
}

const fetchBase64ViaCanvas = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');
        ctx.drawImage(img, 0, 0);
        const dataURL = canvas.toDataURL('image/jpeg', 0.9);
        resolve(dataURL);
      } catch (e) {
        reject(new Error('Canvas taint error: ' + (e as Error).message));
      }
    };
    img.onerror = () => reject(new Error('Failed to load image into canvas'));
    img.src = url;
  });
};

const fetchBase64String = async (url: string): Promise<string> => {
  if (!url) throw new Error('Empty URL');

  let absoluteUrl = url;
  if (absoluteUrl.startsWith('//')) {
    absoluteUrl = 'https:' + absoluteUrl;
  } else if (!absoluteUrl.startsWith('http')) {
    absoluteUrl = 'https://' + absoluteUrl;
  }

  // 尝试 0: 纯前端 Canvas 提取 (利用用户真实 IP 绕过服务器防盗链)
  try {
    const base64 = await fetchBase64ViaCanvas(absoluteUrl);
    return base64;
  } catch (canvasError) {
    console.warn(`[Image Fetch] Canvas extraction failed, falling back to proxies:`, canvasError);
  }

  const MAX_RETRIES = 4;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let proxyUrl = '';
      if (attempt === 1) {
        // Attempt 1: Vercel Serverless API (Works in Vercel deployment)
        proxyUrl = `/api/fetch-image?url=${encodeURIComponent(absoluteUrl)}`;
      } else if (attempt === 2) {
        // Attempt 2: allorigins.win (High success rate for CORS)
        proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(absoluteUrl)}`;
      } else if (attempt === 3) {
        // Attempt 3: images.weserv.nl (Fallback for local dev or if API fails)
        proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(absoluteUrl)}&output=webp`;
      } else {
        // Attempt 4: corsproxy.io (Final fallback)
        proxyUrl = `https://corsproxy.io/?${encodeURIComponent(absoluteUrl)}`;
      }
      
      const res = await fetch(proxyUrl, { mode: 'cors' });
      if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);
      
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        throw new Error('Received HTML instead of image (likely SPA fallback)');
      }
      
      const blob = await res.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      if (attempt < MAX_RETRIES) {
         await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw new Error(`Failed to fetch image`);
};

const fetchBase64Obj = async (url: string): Promise<{data: string, mimeType: string} | null> => {
  try {
    const base64String = await fetchBase64String(url);
    const match = base64String.match(/^data:(image\/\w+);base64,([\s\S]+)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    } else {
      const rawMatch = base64String.match(/^data:([^;]+);base64,([\s\S]+)$/);
      if (rawMatch) {
         return { mimeType: rawMatch[1], data: rawMatch[2] };
      }
    }
  } catch (e) {
    console.error(e);
  }
  return null;
};

const getProxiedImageUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  
  let absoluteUrl = url;
  if (absoluteUrl.startsWith('//')) {
    absoluteUrl = 'https:' + absoluteUrl;
  } else if (!absoluteUrl.startsWith('http')) {
    absoluteUrl = 'https://' + absoluteUrl;
  }
  
  // 纯前端展示（<img> 标签配合 referrerPolicy="no-referrer"）不需要代理，直接返回原图即可。
  // 这样可以彻底避免因为代理失效导致的前端图片裂开问题，同时兼容 AI Studio 和 Vercel。
  return absoluteUrl;
};

function SmartImage({
  src,
  alt,
  className,
  referrerPolicy = 'no-referrer'
}: {
  src: string;
  alt?: string;
  className?: string;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
}) {
  const normalized = getProxiedImageUrl(src);
  if (!normalized) return null;
  return (
    <img
      src={normalized}
      alt={alt || ''}
      className={className}
      referrerPolicy={referrerPolicy}
    />
  );
}

// --- Types ---

type StepStatus = 'idle' | 'processing' | 'success' | 'warning' | 'error';

interface StepResult<T> {
  status: StepStatus;
  data?: T;
  error?: string;
}

interface ProductPipeline {
  id: string;
  name: string;
  image: string;
  rawRow: any;
  overallStatus: 'idle' | 'processing' | 'completed' | 'failed';
  factSheet: StepResult<FactSheet>;
  seo: StepResult<SEOData>;
  marketing: StepResult<MarketingData>;
  attributes: StepResult<{optimized: string, changes: string[]}>;
  description: StepResult<CleanedDescriptions> & { originalData?: CleanedDescriptions };
  compliance: StepResult<ProductImageCheckReport>;
  remaster: StepResult<RemasteredImage & { imgbbUrl?: string }>;
}

interface TaskRunSummary {
  id: string;
  filename: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_items: number;
  completed_items: number;
  failed_items: number;
  created_at: string;
  updated_at: string;
}

// --- Main Component ---

export default function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);

  const [products, setProducts] = useState<ProductPipeline[]>([]);
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const isQueueRunningRef = useRef(false);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [selectingImageFor, setSelectingImageFor] = useState<string | null>(null);
  const [enableImageRemaster, setEnableImageRemaster] = useState(true);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState('');
  const [newAttrKey, setNewAttrKey] = useState('');
  const [newAttrValue, setNewAttrValue] = useState('');
  const [addingAttrId, setAddingAttrId] = useState<string | null>(null);
  const [editingComplianceId, setEditingComplianceId] = useState<string | null>(null);
  
  // Cleaning Preferences
  const [removeSupplierInfo, setRemoveSupplierInfo] = useState(false);
  const [removeFAQ, setRemoveFAQ] = useState(false);
  
  // Upload State
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [pageMode, setPageMode] = useState<'home' | 'taskList' | 'workspace'>('home');
  const [taskRuns, setTaskRuns] = useState<TaskRunSummary[]>([]);
  const [taskRunsLoading, setTaskRunsLoading] = useState(false);
  const [taskRunsError, setTaskRunsError] = useState('');
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const snapshotSaveTimer = useRef<number | null>(null);

  const TASK_SNAPSHOT_KEY = 'ali_opt_task_snapshots_v1';

  const saveTaskSnapshotLocal = (taskId: string, data: ProductPipeline[]) => {
    try {
      // Strip large rawRow fields (HTML descriptions) before saving to avoid localStorage quota issues
      const stripped = data.map(p => ({
        ...p,
        rawRow: Object.fromEntries(
          Object.entries(p.rawRow || {}).filter(([k]) =>
            !k.includes('描述') && !k.includes('description') && !k.includes('Description')
          )
        )
      }));
      const raw = localStorage.getItem(TASK_SNAPSHOT_KEY);
      const map = raw ? JSON.parse(raw) : {};
      // Only keep last 20 task snapshots to prevent unbounded growth
      const keys = Object.keys(map);
      if (keys.length >= 20 && !map[taskId]) {
        delete map[keys[0]];
      }
      map[taskId] = { products: stripped, updatedAt: Date.now() };
      localStorage.setItem(TASK_SNAPSHOT_KEY, JSON.stringify(map));
    } catch (e) {
      console.warn('save snapshot failed', e);
    }
  };

  const loadTaskSnapshotLocal = (taskId: string): ProductPipeline[] | null => {
    try {
      const raw = localStorage.getItem(TASK_SNAPSHOT_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const snap = map?.[taskId];
      return Array.isArray(snap?.products) ? snap.products : null;
    } catch {
      return null;
    }
  };

  const scheduleTaskSnapshotSave = (nextProducts?: ProductPipeline[]) => {
    if (!currentTaskId) return;
    if (snapshotSaveTimer.current) {
      window.clearTimeout(snapshotSaveTimer.current);
    }
    snapshotSaveTimer.current = window.setTimeout(() => {
      saveTaskSnapshotLocal(currentTaskId, nextProducts ?? products);
    }, 600);
  };

  const refreshTaskRuns = async () => {
    setTaskRunsLoading(true);
    setTaskRunsError('');
    try {
      const list = await taskList(50);
      setTaskRuns(list as TaskRunSummary[]);
    } catch (e: any) {
      setTaskRunsError(e?.message || '加载任务列表失败');
    } finally {
      setTaskRunsLoading(false);
    }
  };

  const resetWorkspaceState = () => {
    setProducts([]);
    setIsQueueRunning(false);
    isQueueRunningRef.current = false;
    setExpandedProductId(null);
    setActiveTabs({});
    setLightboxImage(null);
    setSelectingImageFor(null);
    setEditingTitleId(null);
    setTempTitle('');
    setNewAttrKey('');
    setNewAttrValue('');
    setAddingAttrId(null);
    setEditingComplianceId(null);
    setUploadStatus('idle');
    setUploadMessage('');
    setSyncMessage('');
    setIsSyncing(false);
    setShowAdmin(false);
    setPageMode('home');
    setCurrentTaskId(null);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const u = await me();
        if (alive) setAuthUser(u);
      } catch {
        if (alive) setAuthUser(null);
      } finally {
        if (alive) setAuthLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (snapshotSaveTimer.current) window.clearTimeout(snapshotSaveTimer.current);
    };
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] text-gray-800 font-sans flex items-center justify-center">
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 正在加载...
        </div>
      </div>
    );
  }

  if (!authUser) {
    return <Login onSuccess={async () => {
      resetWorkspaceState();
      setAuthUser(await me());
    }} />;
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadStatus('uploading');
    setUploadMessage('正在解析产品表...');

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const parsedProducts: ProductPipeline[] = jsonData.map((row: any, index) => {
          const id = row['店小秘产品ID'] || row['产品ID'] || row['ID'] || `PROD-${index}`;
          const name = row['产品名称'] || row['标题'] || row['Title'] || '';
          const imagesStr = row['产品图片'] || row['图片'] || row['Images'] || '';
          const image = imagesStr.split(';')[0] || '';

          return {
            id: String(id),
            name,
            image,
            rawRow: { ...row, '上传时间': new Date().toLocaleString('zh-CN', { hour12: false }) },
            overallStatus: 'idle',
            factSheet: { status: 'idle' },
            seo: { status: 'idle' },
            marketing: { status: 'idle' },
            attributes: { status: 'idle' },
            description: { status: 'idle' },
            compliance: { status: 'idle' },
            remaster: { status: 'idle' }
          };
        });

        setProducts(parsedProducts);
        setPageMode('workspace');
        setUploadStatus('success');
        setIsSyncing(true);
        setSyncMessage(`正在同步 ${parsedProducts.length} 个产品到云端...`);
        void auditClientEvent('products.upload', {
          filename: file.name,
          itemCount: parsedProducts.length,
          firstSheetName: sheetName
        }).catch((err) => console.warn('audit upload failed', err));

        void (async () => {
          try {
            const task = await taskCreate({
              filename: file.name,
              totalItems: parsedProducts.length,
              status: 'queued'
            });
            setCurrentTaskId(task.id);
            saveTaskSnapshotLocal(task.id, parsedProducts);
            await refreshTaskRuns();
          } catch (err) {
            console.warn('create task failed', err);
          }
        })();

        // 同步数据到 Google Sheets（带重试 + 超时）
        void (async () => {
          const sync = await postGoogleSheetsWithRetry({
            action: 'upload',
            sheetName: '产品表 (Product List)',
            data: jsonData
          }, 3, 15000);

          setIsSyncing(false);
          if (sync.ok) {
            setSyncMessage(`成功导入并同步 ${parsedProducts.length} 个产品`);
            setTimeout(() => setSyncMessage(''), 3000);
            void auditClientEvent('sheets.upload_sync.success', {
              filename: file.name,
              itemCount: parsedProducts.length,
              attempts: sync.attempts
            }).catch((err) => console.warn('audit sheets upload success failed', err));
          } else {
            setSyncMessage(`云端同步失败（已重试${sync.attempts}次）: ${sync.error}`);
            void auditClientEvent('sheets.upload_sync.fail', {
              filename: file.name,
              itemCount: parsedProducts.length,
              attempts: sync.attempts,
              error: sync.error
            }).catch((err) => console.warn('audit sheets upload fail failed', err));
          }
        })();

      } catch (error) {
        console.error(error);
        setUploadStatus('error');
        setUploadMessage('解析失败，请确保上传的是有效的 Excel 文件');
      }
    };
    reader.readAsBinaryString(file);
  };

  const updateProduct = (id: string, updates: Partial<ProductPipeline>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const syncProductToGoogleSheets = async (product: ProductPipeline) => {
    try {
      const row = { ...product.rawRow };
      
      if (product.seo.data) {
        const titleCol = '产品名称' in row ? '产品名称' : '标题' in row ? '标题' : 'Title' in row ? 'Title' : '产品名称';
        row[titleCol] = product.seo.data.optimized_title;
      }
      if (product.attributes.data) {
        const attrCol = '自定义属性' in row ? '自定义属性' : '产品属性' in row ? '产品属性' : '自定义属性';
        row[attrCol] = product.attributes.data.optimized;
      }
      if (product.description.data) {
        const pc1Col = '产品详细描述1' in row ? '产品详细描述1' : '产品描述1' in row ? '产品描述1' : '产品详细描述1';
        const pc2Col = '产品详细描述2' in row ? '产品详细描述2' : '产品描述2' in row ? '产品描述2' : '产品详细描述2';
        const mobile1Col = '移动端描述1' in row ? '移动端描述1' : '移动端详细描述1' in row ? '移动端详细描述1' : '移动端描述1';
        const mobile2Col = '移动端描述2' in row ? '移动端描述2' : '移动端详细描述2' in row ? '移动端详细描述2' : '移动端描述2';
        
        row[pc1Col] = product.description.data.pc1;
        row[pc2Col] = product.description.data.pc2;
        row[mobile1Col] = product.description.data.mobile1;
        row[mobile2Col] = product.description.data.mobile2;
      }
      if (product.marketing.data) {
        const matrixStr = `风格矩阵: ${product.marketing.data.category_matrix}`;
        const pointsStr = product.marketing.data.points.map(pt => `${pt.header}: ${pt.content}`).join('\n');
        row['站外SEO黄金五点'] = `${matrixStr}\n${pointsStr}`;
      }
      if (product.remaster.data?.imgbbUrl) {
        const imgCol = '产品图片' in row ? '产品图片' : '图片' in row ? '图片' : 'Images' in row ? 'Images' : '产品图片';
        const images = (row[imgCol] || '').split(';');
        images[0] = product.remaster.data.imgbbUrl;
        row[imgCol] = images.join(';');
      }

      const optTime = new Date().toLocaleString('zh-CN', { hour12: false });
      row['初步优化时间'] = optTime;
      
      updateProduct(product.id, { rawRow: { ...row } });

      const saveResult = await postGoogleSheetsWithRetry({
        action: 'saveOptimizationData',
        productId: product.id,
        sheetName: 'Optimized Products',
        rowData: row
      }, 3, 12000);
      if (!saveResult.ok) throw new Error(`saveOptimizationData failed: ${saveResult.error}`);

      const updateTimeResult = await postGoogleSheetsWithRetry({
        action: 'updateOriginalTime',
        productId: product.id,
        optTime: optTime
      }, 3, 12000);
      if (!updateTimeResult.ok) throw new Error(`updateOriginalTime failed: ${updateTimeResult.error}`);
    } catch (error) {
      console.error('Failed to sync to Google Sheets:', error);
      void auditClientEvent('sheets.product_sync.fail', {
        productId: product.id,
        error: String((error as any)?.message || error || 'unknown')
      }).catch((err) => console.warn('audit sheets product sync failed', err));
    }
  };

  const handleManualRemaster = async (product: ProductPipeline) => {
    if (!product.factSheet.data) return;
    updateProduct(product.id, { remaster: { status: 'processing' } });
    try {
      const remasterData = await withRetry(() => remasterImage(product.image, product.name, 'General', fetchBase64Obj, product.factSheet.data!), 5);
      const imgbbUrl = await withRetry(() => uploadToImgBB(remasterData.remasteredUrl), 5);
      updateProduct(product.id, { remaster: { status: 'success', data: { ...remasterData, imgbbUrl } } });
    } catch (error: any) {
      updateProduct(product.id, { remaster: { status: 'error', error: error.message } });
    }
  };

  const handleRetryProduct = async (product: ProductPipeline) => {
    // Reset product status to idle and clear previous errors
    updateProduct(product.id, { 
      overallStatus: 'idle',
      factSheet: { status: 'idle' },
      seo: { status: 'idle' },
      marketing: { status: 'idle' },
      attributes: { status: 'idle' },
      description: { status: 'idle' },
      compliance: { status: 'idle' },
      remaster: { status: 'idle' }
    });
    
    // Process it directly as a manual run
    const updatedProduct = products.find(p => p.id === product.id) || product;
    await processProduct(updatedProduct, true);
  };

  const syncTaskProgress = async (status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled') => {
    if (!currentTaskId) return;
    const completed = products.filter(p => p.overallStatus === 'completed').length;
    const failed = products.filter(p => p.overallStatus === 'failed').length;
    try {
      await taskUpdate(currentTaskId, {
        status,
        completedItems: completed,
        failedItems: failed
      });
    } catch (err) {
      console.warn('sync task progress failed', err);
    }
  };

  const processProduct = async (product: ProductPipeline, isManual = false) => {
    updateProduct(product.id, { overallStatus: 'processing' });

    let factSheetData: FactSheet | undefined;
    let seoData: SEOData | undefined;
    let marketingData: MarketingData | undefined;
    let attrData: {optimized: string, changes: string[]} | undefined;
    let descData: CleanedDescriptions | undefined;
    let originalDescData: CleanedDescriptions | undefined;
    let finalRemasterData: (RemasteredImage & { imgbbUrl?: string }) | undefined;

    // 1. Fact Sheet (Core)
    updateProduct(product.id, { factSheet: { status: 'processing' } });
    try {
      factSheetData = await withRetry(() => extractFactSheet(
        product.name, 
        product.rawRow['自定义属性'] || product.rawRow['产品属性'] || '', 
        product.rawRow['产品详细描述1'] || product.rawRow['产品描述1'] || ''
      ));
      updateProduct(product.id, { factSheet: { status: 'success', data: factSheetData } });
    } catch (error: any) {
      updateProduct(product.id, { 
        factSheet: { status: 'error', error: error.message },
        overallStatus: 'failed' 
      });
      return; // Stop processing this product
    }

    // 2. SEO Title
    if (!isManual && !isQueueRunningRef.current) return;
    updateProduct(product.id, { seo: { status: 'processing' } });
    try {
      seoData = await withRetry(() => optimizeTitle(factSheetData!, product.name));
      updateProduct(product.id, { seo: { status: 'success', data: seoData } });
    } catch (error: any) {
      updateProduct(product.id, { seo: { status: 'warning', error: error.message } });
    }

    // 3. Marketing Points
    if (!isManual && !isQueueRunningRef.current) return;
    updateProduct(product.id, { marketing: { status: 'processing' } });
    try {
      marketingData = await withRetry(() => generateMarketingPoints(factSheetData!));
      updateProduct(product.id, { marketing: { status: 'success', data: marketingData } });
    } catch (error: any) {
      updateProduct(product.id, { marketing: { status: 'warning', error: error.message } });
    }

    // 4. Attributes
    if (!isManual && !isQueueRunningRef.current) return;
    updateProduct(product.id, { attributes: { status: 'processing' } });
    try {
      attrData = await withRetry(() => optimizeAttributes(product.rawRow['自定义属性'] || product.rawRow['产品属性'] || '', factSheetData!));
      updateProduct(product.id, { attributes: { status: 'success', data: attrData } });
    } catch (error: any) {
      updateProduct(product.id, { attributes: { status: 'warning', error: error.message } });
    }

    // 5. Description
    if (!isManual && !isQueueRunningRef.current) return;
    updateProduct(product.id, { description: { status: 'processing' } });
    try {
      descData = await withRetry(() => cleanDescriptions(
        product.rawRow['产品详细描述1'] || product.rawRow['产品描述1'] || '',
        product.rawRow['产品详细描述2'] || product.rawRow['产品描述2'] || '',
        product.rawRow['移动端描述1'] || product.rawRow['移动端详细描述1'] || '',
        product.rawRow['移动端描述2'] || product.rawRow['移动端详细描述2'] || '',
        factSheetData,
        {
          removeSupplierInfo,
          removeFAQ,
          originalTitle: product.rawRow['产品标题'] || product.rawRow['标题'] || product.name
        }
      ));
      originalDescData = JSON.parse(JSON.stringify(descData));
      updateProduct(product.id, { description: { status: 'success', data: descData, originalData: originalDescData } });
    } catch (error: any) {
      updateProduct(product.id, { description: { status: 'warning', error: error.message } });
    }

    // 6. Image Compliance
    if (!isManual && !isQueueRunningRef.current) return;
    updateProduct(product.id, { compliance: { status: 'processing' } });
    try {
      const htmls = [
        product.rawRow['产品详细描述1'] || product.rawRow['产品描述1'] || '',
        product.rawRow['产品详细描述2'] || product.rawRow['产品描述2'] || '',
        product.rawRow['移动端描述1'] || product.rawRow['移动端详细描述1'] || '',
        product.rawRow['移动端描述2'] || product.rawRow['移动端详细描述2'] || ''
      ];
      const allImages = htmls.flatMap(html => extractImagesFromHtml(html));
      const uniqueImages = Array.from(new Set(allImages));
      
      const report: ProductImageCheckReport = { productId: product.id, images: [], hasRisk: false };
      
      for (let i = 0; i < uniqueImages.length; i += 3) {
        const chunk = uniqueImages.slice(i, i + 3);
        const results = await Promise.all(chunk.map(async (imgUrl) => {
          try {
            return await checkImageRisk(imgUrl, fetchBase64Obj, {
              productName: product.name,
              compatibility: factSheetData?.compatibility,
              removeSupplierInfo
            });
          } catch (e) {
            return { url: imgUrl, isRisky: false, reason: '检测失败' };
          }
        }));
        report.images.push(...results);
      }
      report.hasRisk = report.images.some(img => img.isRisky);
      updateProduct(product.id, { compliance: { status: 'success', data: report } });

      // Auto-remove risky images from description HTML
      if (descData && originalDescData) {
        const riskyUrls = report.images.filter(img => img.isRisky).map(img => img.url);
        const removeImagesFromHtml = (html: string) => {
          if (!html) return html;
          let newHtml = html;
          riskyUrls.forEach(url => {
            const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const imgRegex = new RegExp(`<img[^>]*src=["']${escapedUrl}["'][^>]*>`, 'gi');
            newHtml = newHtml.replace(imgRegex, '');
          });
          // Clean up empty tags left behind
          newHtml = newHtml.replace(/<p[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/p>/gi, '');
          newHtml = newHtml.replace(/<div[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/div>/gi, '');
          newHtml = newHtml.replace(/<span[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/span>/gi, '');
          newHtml = newHtml.replace(/(<br\s*\/?>\s*){2,}/gi, '<br/>');
          return newHtml;
        };
        descData.pc1 = removeImagesFromHtml(originalDescData.pc1);
        descData.pc2 = removeImagesFromHtml(originalDescData.pc2);
        descData.mobile1 = removeImagesFromHtml(originalDescData.mobile1);
        descData.mobile2 = removeImagesFromHtml(originalDescData.mobile2);
        updateProduct(product.id, { description: { status: 'success', data: descData, originalData: originalDescData } });
      }
    } catch (error: any) {
      updateProduct(product.id, { compliance: { status: 'warning', error: error.message } });
    }

    // 7. Remaster Image
    if (!isManual && !isQueueRunningRef.current) return;
    if (!enableImageRemaster) {
      updateProduct(product.id, { remaster: { status: 'idle' } });
    } else {
      updateProduct(product.id, { remaster: { status: 'processing' } });
      try {
        const remasterData = await withRetry(() => remasterImage(product.image, product.name, 'General', fetchBase64Obj, factSheetData!), 5);
        const imgbbUrl = await withRetry(() => uploadToImgBB(remasterData.remasteredUrl), 5);
        finalRemasterData = { ...remasterData, imgbbUrl };
        updateProduct(product.id, { remaster: { status: 'success', data: finalRemasterData } });
      } catch (error: any) {
        updateProduct(product.id, { remaster: { status: 'error', error: error.message } });
      }
    }

    // 8. Sync to Google Sheets
    const updatedProduct = {
      ...product,
      seo: { status: 'success' as StepStatus, data: seoData },
      marketing: { status: 'success' as StepStatus, data: marketingData },
      attributes: { status: 'success' as StepStatus, data: attrData },
      description: { status: 'success' as StepStatus, data: descData, originalData: originalDescData },
      remaster: { status: 'success' as StepStatus, data: finalRemasterData }
    };
    // Sheets sync is fire-and-forget: product is marked complete immediately,
    // sync runs in background so it never blocks the optimization pipeline.
    void syncProductToGoogleSheets(updatedProduct);

    updateProduct(product.id, { overallStatus: 'completed' });
  };

  const togglePipeline = async () => {
    if (isQueueRunning) {
      setIsQueueRunning(false);
      isQueueRunningRef.current = false;
      void syncTaskProgress('cancelled');
      return;
    }

    setIsQueueRunning(true);
    isQueueRunningRef.current = true;
    void syncTaskProgress('running'); // fire-and-forget: must not block worker startup
    
    // 提取所有待处理任务
    const idleProducts = products.filter(p => p.overallStatus === 'idle');
    let currentIndex = 0;

    const MAX_CONCURRENCY = 3;
    let activeWorkers = 0;

    const worker = async () => {
      while (isQueueRunningRef.current) {
        // 同步获取下一个任务索引，避免 React 异步状态更新导致的竞态条件
        const index = currentIndex++;
        if (index >= idleProducts.length) {
          break;
        }
        
        const nextProduct = idleProducts[index];
        if (!nextProduct) break;

        activeWorkers++;
        // 立即更新 UI 状态为处理中
        updateProduct(nextProduct.id, { overallStatus: 'processing' });
        
        await processProduct(nextProduct);
        activeWorkers--;
      }
    };

    const workers = [];
    for (let i = 0; i < MAX_CONCURRENCY; i++) {
      workers.push(worker());
    }
    
    await Promise.all(workers);
    
    if (activeWorkers === 0) {
      setIsQueueRunning(false);
      isQueueRunningRef.current = false;
      // Use functional updater to get current products state (avoid stale closure)
      setProducts(current => {
        const completed = current.filter(p => p.overallStatus === 'completed').length;
        const failed = current.filter(p => p.overallStatus === 'failed').length;
        const total = current.length;
        const finalStatus =
          completed + failed >= total
            ? (failed > 0 ? 'failed' : 'completed')
            : 'running';
        void syncTaskProgress(finalStatus);
        // Save final snapshot only once when pipeline completes
        if (currentTaskId) saveTaskSnapshotLocal(currentTaskId, current);
        return current;
      });
      void refreshTaskRuns();
    }
  };

  const handleExport = () => {
    const exportData = products.map(p => {
      const row = { ...p.rawRow };
      
      if (p.seo.data) {
        const titleCol = '产品名称' in row ? '产品名称' : '标题' in row ? '标题' : 'Title' in row ? 'Title' : '产品名称';
        row[titleCol] = p.seo.data.optimized_title;
      }
      if (p.attributes.data) {
        const attrCol = '自定义属性' in row ? '自定义属性' : '产品属性' in row ? '产品属性' : '自定义属性';
        row[attrCol] = p.attributes.data.optimized;
      }
      if (p.description.data) {
        const pc1Col = '产品详细描述1' in row ? '产品详细描述1' : '产品描述1' in row ? '产品描述1' : '产品详细描述1';
        const pc2Col = '产品详细描述2' in row ? '产品详细描述2' : '产品描述2' in row ? '产品描述2' : '产品详细描述2';
        const mobile1Col = '移动端描述1' in row ? '移动端描述1' : '移动端详细描述1' in row ? '移动端详细描述1' : '移动端描述1';
        const mobile2Col = '移动端描述2' in row ? '移动端描述2' : '移动端详细描述2' in row ? '移动端详细描述2' : '移动端描述2';
        
        const title = p.seo.data?.optimized_title || p.name;
        const marketingData = p.marketing.data;

        row[pc1Col] = generateFinalHtml(p.description.data.pc1, title, marketingData);
        row[pc2Col] = generateFinalHtml(p.description.data.pc2, title, marketingData);
        row[mobile1Col] = generateFinalHtml(p.description.data.mobile1, title, marketingData);
        row[mobile2Col] = generateFinalHtml(p.description.data.mobile2, title, marketingData);
      }
      if (p.marketing.data) {
        const matrixStr = `风格矩阵: ${p.marketing.data.category_matrix}`;
        const pointsStr = p.marketing.data.points.map(pt => `${pt.header}: ${pt.content}`).join('\n');
        row['站外SEO黄金五点'] = `${matrixStr}\n${pointsStr}`;
      }
      if (p.remaster.data?.imgbbUrl) {
        const imgCol = '产品图片' in row ? '产品图片' : '图片' in row ? '图片' : 'Images' in row ? 'Images' : '产品图片';
        const images = (row[imgCol] || '').split(';');
        images[0] = p.remaster.data.imgbbUrl;
        row[imgCol] = images.join(';');
      }
      
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Optimized Products");
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    
    let storeName = '';
    if (products.length > 0 && products[0].rawRow['所属店铺']) {
      storeName = products[0].rawRow['所属店铺'];
    }
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timeString = `${year}${month}${day}_${hours}${minutes}`;
    
    const filename = storeName 
      ? `${storeName}_优化后产品_${timeString}.xlsx` 
      : `优化后产品_${timeString}.xlsx`;

    saveAs(blob, filename);
    void auditClientEvent('products.export', {
      filename,
      itemCount: products.length,
      completedCount,
      failedCount
    }).catch((err) => console.warn('audit export failed', err));
  };

  const completedCount = products.filter(p => p.overallStatus === 'completed').length;
  const failedCount = products.filter(p => p.overallStatus === 'failed').length;

  const StatusIcon = ({ status }: { status: StepStatus }) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'processing': return <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      default: return <div className="w-4 h-4 rounded-full border-2 border-slate-200" />;
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-800 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black rounded-xl flex items-center justify-center shadow-sm">
              <Sparkles className="text-white w-4 h-4" />
            </div>
            <h1 className="text-[17px] font-semibold text-gray-900 tracking-tight">全球商品智能优化系统 V2.0</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="text-xs font-medium text-slate-500 hidden sm:block">
              当前用户：<span className="text-slate-800">{authUser.username}</span>
            </div>
            <button
              onClick={async () => {
                setPageMode('taskList');
                await refreshTaskRuns();
              }}
              className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 shadow-sm"
            >
              任务列表
            </button>

            {authUser.role === 'admin' && (
              <button
                onClick={() => setShowAdmin(true)}
                className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 shadow-sm"
              >
                管理员
              </button>
            )}

            <button
              onClick={() => {
                clearToken();
                resetWorkspaceState();
                setAuthUser(null);
              }}
              className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 shadow-sm"
            >
              退出
            </button>
          </div>

          {pageMode === 'workspace' && products.length > 0 && (
            <div className="flex items-center gap-4">
              {syncMessage && (
                <div className={`text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-2 ${isSyncing ? 'bg-blue-50 text-blue-600' : syncMessage.includes('失败') || syncMessage.includes('异常') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {isSyncing && <Loader2 className="w-3 h-3 animate-spin" />}
                  {syncMessage}
                </div>
              )}
              <div className="flex flex-col gap-1 mr-2 min-w-[160px]">
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>进度 ({completedCount}/{products.length})</span>
                  <span className="text-emerald-600">{Math.round((completedCount / products.length) * 100)}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden flex">
                  <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${(completedCount / products.length) * 100}%` }} />
                  <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${(failedCount / products.length) * 100}%` }} />
                </div>
              </div>
              <button
                onClick={() => {
                  if (isQueueRunningRef.current) {
                    const ok = window.confirm('当前仍在批量优化中，确认停止并返回首页吗？');
                    if (!ok) return;
                  }
                  resetWorkspaceState();
                }}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 flex items-center gap-2 shadow-sm"
              >
                <Upload size={16} /> 返回首页
              </button>
              <button
                onClick={togglePipeline}
                className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-sm ${
                  isQueueRunning 
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {isQueueRunning ? <><Pause size={16} /> 暂停优化</> : <><Play size={16} /> 开始批量优化</>}
              </button>
              <button
                onClick={handleExport}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 flex items-center gap-2 shadow-sm"
              >
                <FileOutput size={16} /> 导出最终表格
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {pageMode !== 'workspace' ? (
          pageMode === 'taskList' ? (
            <div className="max-w-4xl mx-auto">
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl font-semibold text-gray-900">任务列表</h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => await refreshTaskRuns()}
                      className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 shadow-sm"
                    >
                      刷新
                    </button>
                    <button
                      onClick={() => setPageMode('home')}
                      className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 shadow-sm"
                    >
                      返回上传首页
                    </button>
                  </div>
                </div>
                {taskRunsError && <div className="text-xs text-red-600 mb-3">{taskRunsError}</div>}
                {taskRunsLoading ? (
                  <div className="text-sm text-gray-500 flex items-center gap-2 py-10 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
                  </div>
                ) : taskRuns.length === 0 ? (
                  <div className="text-sm text-gray-500 py-8 text-center">暂无历史任务</div>
                ) : (
                  <div className="space-y-3">
                    {taskRuns.map((t) => (
                      <div key={t.id} className="border border-gray-100 rounded-xl p-4 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{t.filename || '未命名任务'}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            创建：{new Date(t.created_at).toLocaleString('zh-CN', { hour12: false })} · 状态：{t.status}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            完成 {t.completed_items}/{t.total_items} · 失败 {t.failed_items}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const snap = loadTaskSnapshotLocal(t.id);
                            if (snap && snap.length > 0) {
                              setProducts(snap);
                              setCurrentTaskId(t.id);
                              setPageMode('workspace');
                            } else {
                              alert('该任务仅有元数据，当前浏览器无可恢复快照。');
                            }
                          }}
                          className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm"
                        >
                          打开任务
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
          <div className="max-w-xl mx-auto mt-20">
            <div className="bg-white rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 p-10 text-center transition-all duration-300">
              <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <FileSpreadsheet className="w-8 h-8 text-gray-800" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2 tracking-tight">导入产品数据</h2>
              <p className="text-gray-500 text-[15px] mb-8">请上传包含产品信息的 Excel 表格，系统将自动进行全链路智能优化。</p>
              
              <label className="relative block w-full">
                <input 
                  type="file" 
                  accept=".xlsx, .xls, .csv" 
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={uploadStatus === 'uploading'}
                />
                <div className={`px-6 py-4 rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-3 ${
                  uploadStatus === 'uploading' ? 'border-indigo-300 bg-indigo-50' :
                  uploadStatus === 'error' ? 'border-red-300 bg-red-50' :
                  'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
                }`}>
                  {uploadStatus === 'uploading' ? (
                    <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                  ) : (
                    <Upload className="w-6 h-6 text-slate-400" />
                  )}
                  <span className="text-sm font-medium text-slate-600">
                    {uploadStatus === 'uploading' ? uploadMessage : '点击或拖拽上传产品表'}
                  </span>
                </div>
              </label>

              <div className="mt-6 flex items-center justify-center gap-3">
                <span className="text-sm font-medium text-slate-600">开启首图 AI 白底重绘</span>
                <button
                  type="button"
                  disabled={uploadStatus === 'uploading'}
                  onClick={() => setEnableImageRemaster(!enableImageRemaster)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                    enableImageRemaster ? 'bg-indigo-600' : 'bg-slate-200'
                  } ${uploadStatus === 'uploading' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      enableImageRemaster ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Cleaning Preferences */}
              <div className="mt-8 text-left border-t border-gray-100 pt-8">
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  清洗偏好设置 (Cleaning Preferences)
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50/50 border border-gray-100">
                    <div>
                      <div className="text-sm font-medium text-gray-900">移除供应商/工厂信息</div>
                      <div className="text-xs text-gray-500 mt-0.5">自动识别并删除图片和描述中的公司介绍、团队合照等</div>
                    </div>
                    <button
                      type="button"
                      disabled={uploadStatus === 'uploading'}
                      onClick={() => setRemoveSupplierInfo(!removeSupplierInfo)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                        removeSupplierInfo ? 'bg-indigo-600' : 'bg-slate-200'
                      } ${uploadStatus === 'uploading' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          removeSupplierInfo ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50/50 border border-gray-100">
                    <div>
                      <div className="text-sm font-medium text-gray-900">移除 FAQ 问答</div>
                      <div className="text-xs text-gray-500 mt-0.5">自动识别并删除描述中的常见问题解答版块</div>
                    </div>
                    <button
                      type="button"
                      disabled={uploadStatus === 'uploading'}
                      onClick={() => setRemoveFAQ(!removeFAQ)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                        removeFAQ ? 'bg-indigo-600' : 'bg-slate-200'
                      } ${uploadStatus === 'uploading' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          removeFAQ ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )) : (
          <div className="space-y-4">
            {products.map(product => (
              <div key={product.id} className="bg-white rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
                {/* Header Row */}
                <div 
                  className="p-5 flex items-center justify-between cursor-pointer hover:bg-gray-50/50 transition-colors"
                  onClick={() => setExpandedProductId(expandedProductId === product.id ? null : product.id)}
                >
                  <div className="flex items-center gap-5 flex-1 min-w-0">
                    <div 
                      className={`group relative w-20 h-20 rounded-[14px] border border-slate-200 bg-white flex items-center justify-center overflow-hidden shrink-0 transition-all duration-300 ${enableImageRemaster ? 'cursor-pointer hover:shadow-md hover:border-indigo-300' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (enableImageRemaster) {
                          setSelectingImageFor(product.id);
                        }
                      }}
                    >
                      {product.image ? (
                        <>
                          <SmartImage src={product.image} alt="" className="max-w-full max-h-full object-contain p-1" />
                          {enableImageRemaster && (
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center text-white backdrop-blur-[2px]">
                              <RefreshCw size={18} className="mb-1" />
                              <span className="text-[10px] font-medium tracking-wide">更换首图</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <ImageIcon className="w-8 h-8 text-slate-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{product.id}</span>
                        {product.overallStatus === 'completed' && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">已完成</span>}
                        {product.overallStatus === 'failed' && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">失败</span>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleRetryProduct(product); }}
                              className="flex items-center gap-1 text-[10px] font-medium text-slate-600 bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-sm hover:shadow hover:bg-slate-50 hover:text-indigo-600 px-2 py-0.5 rounded-full transition-all duration-200"
                            >
                              <RefreshCw size={10} />
                              重试
                            </button>
                          </div>
                        )}
                        {product.overallStatus === 'processing' && <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded flex items-center gap-1"><Loader2 size={10} className="animate-spin"/> 处理中</span>}
                      </div>
                      <h3 className="text-sm font-medium text-slate-800 truncate">{product.name}</h3>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6 shrink-0 ml-4">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center gap-1" title="Fact Sheet"><StatusIcon status={product.factSheet.status} /></div>
                      <div className="flex flex-col items-center gap-1" title="SEO 标题"><StatusIcon status={product.seo.status} /></div>
                      <div className="flex flex-col items-center gap-1" title="黄金五点"><StatusIcon status={product.marketing.status} /></div>
                      <div className="flex flex-col items-center gap-1" title="属性"><StatusIcon status={product.attributes.status} /></div>
                      <div className="flex flex-col items-center gap-1" title="描述"><StatusIcon status={product.description.status} /></div>
                      <div className="flex flex-col items-center gap-1" title="图片合规"><StatusIcon status={product.compliance.status} /></div>
                      {enableImageRemaster && <div className="flex flex-col items-center gap-1" title="首图重绘"><StatusIcon status={product.remaster.status} /></div>}
                    </div>
                    {expandedProductId === product.id ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedProductId === product.id && (
                  <div className="border-t border-slate-100 bg-slate-50/50 flex flex-col">
                    {/* Segmented Control Header */}
                    <div className="p-4 bg-white/60 backdrop-blur-xl border-b border-slate-200/60 sticky top-0 z-10">
                      <div className="flex bg-slate-100/80 p-1 rounded-xl w-fit mx-auto">
                        {[
                          { id: 'seo', label: '概览与 SEO', icon: Sparkles },
                          { id: 'attributes', label: '属性清洗', icon: LayoutDashboard },
                          { id: 'description', label: '描述与排版', icon: FileSpreadsheet },
                          { id: 'images', label: '图片合规与重绘', icon: ImageIcon }
                        ].map(tab => {
                          const isActive = (activeTabs[product.id] || 'seo') === tab.id;
                          const Icon = tab.icon;
                          return (
                            <button
                              key={tab.id}
                              onClick={() => setActiveTabs(prev => ({ ...prev, [product.id]: tab.id }))}
                              className={`px-5 py-2 text-[13px] font-medium flex items-center gap-2 rounded-lg transition-all duration-200 ${
                                isActive 
                                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5' 
                                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                              }`}
                            >
                              <Icon size={15} className={isActive ? 'text-indigo-500' : ''} /> {tab.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tab Content */}
                    <div className="p-6">
                      {(activeTabs[product.id] || 'seo') === 'seo' && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {/* SEO Title */}
                          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <h4 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                              <StatusIcon status={product.seo.status} /> SEO 标题优化
                            </h4>
                            <div className="space-y-4">
                              <div>
                                <div className="text-xs text-slate-400 mb-1">原标题</div>
                                <div className="text-sm text-slate-600">{product.name}</div>
                              </div>
                              <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 transition-all duration-200">
                                <div className="flex justify-between items-center mb-2">
                                  <div className="text-xs text-indigo-600 font-bold flex items-center gap-2">
                                    优化后标题
                                    {product.seo.data && editingTitleId !== product.id && (
                                      <button 
                                        onClick={() => {
                                          setEditingTitleId(product.id);
                                          setTempTitle(product.seo.data!.optimized_title);
                                        }}
                                        className="text-indigo-400 hover:text-indigo-600 transition-colors"
                                        title="编辑标题"
                                      >
                                        <Edit2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                  {product.seo.data?.character_count && (
                                    <div className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                                      (editingTitleId === product.id ? tempTitle.length : product.seo.data.character_count) < 110 
                                        ? 'bg-amber-50 border-amber-200 text-amber-600' 
                                        : 'bg-white border-indigo-200 text-indigo-600'
                                    }`}>
                                      {editingTitleId === product.id ? tempTitle.length : product.seo.data.character_count} 字符
                                    </div>
                                  )}
                                </div>
                                {editingTitleId === product.id ? (
                                  <div className="space-y-2">
                                    <textarea
                                      value={tempTitle}
                                      onChange={(e) => setTempTitle(e.target.value)}
                                      className="w-full text-sm font-medium text-slate-800 bg-white border-2 border-indigo-300 focus:border-indigo-500 focus:ring-0 rounded-lg p-2 min-h-[80px] outline-none transition-all resize-y"
                                      autoFocus
                                    />
                                    <div className="flex justify-end gap-2">
                                      <button
                                        onClick={() => setEditingTitleId(null)}
                                        className="px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm transition-colors"
                                      >
                                        取消
                                      </button>
                                      <button
                                        onClick={() => {
                                          if (product.seo.data) {
                                            const updatedSeo = {
                                              ...product.seo,
                                              data: {
                                                ...product.seo.data,
                                                optimized_title: tempTitle,
                                                character_count: tempTitle.length
                                              }
                                            };
                                            updateProduct(product.id, { seo: updatedSeo });
                                            syncProductToGoogleSheets({ ...product, seo: updatedSeo });
                                            setEditingTitleId(null);
                                          }
                                        }}
                                        className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm transition-colors flex items-center gap-1"
                                      >
                                        <Save size={12} /> 保存
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-sm font-medium text-slate-800">
                                    {product.seo.data?.optimized_title || <span className="text-slate-400 italic">等待生成...</span>}
                                  </div>
                                )}
                              </div>
                              {product.seo.data?.core_keywords_embedded && (
                                <div>
                                  <div className="text-xs text-slate-400 mb-2">埋入关键词</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {product.seo.data.core_keywords_embedded.map((kw, idx) => (
                                      <span key={idx} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded-md border border-slate-200">{kw}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {product.seo.data?.modification_reasons && (
                                <div>
                                  <div className="text-xs text-slate-400 mb-1">优化原因</div>
                                  <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">{product.seo.data.modification_reasons}</div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Marketing Points */}
                          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <h4 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                              <StatusIcon status={product.marketing.status} /> 黄金五点 (站外SEO)
                            </h4>
                            <div className="space-y-3">
                              {product.marketing.data ? (
                                <>
                                  <div className="inline-flex text-xs font-medium bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg border border-emerald-100 mb-2">
                                    风格矩阵: {product.marketing.data.category_matrix}
                                  </div>
                                  <div className="space-y-2">
                                    {product.marketing.data.points.map((point, idx) => (
                                      <div key={idx} className="text-sm p-3 bg-slate-50 rounded-xl border border-slate-100">
                                        <span className="font-bold text-slate-800 block mb-1">{point.header}</span>
                                        <span className="text-slate-600 text-xs leading-relaxed">{point.content}</span>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <div className="text-sm text-slate-400 italic">等待生成...</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {(activeTabs[product.id] || 'seo') === 'attributes' && (
                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                          <h4 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <StatusIcon status={product.attributes.status} /> 自定义属性清洗
                          </h4>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div>
                              <div className="text-xs font-bold text-slate-500 mb-2">清洗后属性</div>
                              {product.attributes.data ? (
                                <div className="space-y-2">
                                  {product.attributes.data.optimized.split('\n').filter(Boolean).map((pair, idx) => {
                                    const [key, ...val] = pair.split(':');
                                    const k = key?.trim();
                                    const v = val.join(':')?.trim();
                                    if (!k || !v) return null;
                                    return (
                                      <div key={idx} className="group flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100 transition-all duration-200 hover:border-indigo-200 hover:shadow-sm">
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{k}</span>
                                          <span className="text-sm font-medium text-slate-700">{v}</span>
                                        </div>
                                        <button 
                                          onClick={() => {
                                            const attrs = product.attributes.data!.optimized.split('\n').filter(Boolean);
                                            attrs.splice(idx, 1);
                                            const newChanges = [...(product.attributes.data!.changes || []), `[手动删除] 移除了属性: ${k}`];
                                            const updatedAttr = {
                                              ...product.attributes,
                                              data: { ...product.attributes.data!, optimized: attrs.join('\n'), changes: newChanges }
                                            };
                                            updateProduct(product.id, { attributes: updatedAttr });
                                            syncProductToGoogleSheets({ ...product, attributes: updatedAttr });
                                          }}
                                          className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                          title="删除属性"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                  
                                  {addingAttrId === product.id ? (
                                    <div className="bg-white p-3 rounded-xl border-2 border-indigo-300 shadow-sm space-y-3 transition-all">
                                      <div className="flex gap-2">
                                        <input 
                                          type="text" 
                                          placeholder="Key (e.g. Material)" 
                                          value={newAttrKey}
                                          onChange={e => setNewAttrKey(e.target.value)}
                                          className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-400"
                                        />
                                        <input 
                                          type="text" 
                                          placeholder="Value (e.g. Wood)" 
                                          value={newAttrValue}
                                          onChange={e => setNewAttrValue(e.target.value)}
                                          className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-400"
                                        />
                                      </div>
                                      <div className="flex justify-end gap-2">
                                        <button onClick={() => setAddingAttrId(null)} className="px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm">取消</button>
                                        <button 
                                          onClick={() => {
                                            if (newAttrKey.trim() && newAttrValue.trim()) {
                                              const currentOpt = product.attributes.data!.optimized;
                                              const newAttr = `${newAttrKey.trim()}:${newAttrValue.trim()}`;
                                              const updatedOpt = currentOpt ? `${currentOpt}\n${newAttr}` : newAttr;
                                              const newChanges = [...(product.attributes.data!.changes || []), `[手动新增] 添加了属性: ${newAttr}`];
                                              const updatedAttr = {
                                                ...product.attributes,
                                                data: { ...product.attributes.data!, optimized: updatedOpt, changes: newChanges }
                                              };
                                              updateProduct(product.id, { attributes: updatedAttr });
                                              syncProductToGoogleSheets({ ...product, attributes: updatedAttr });
                                              setNewAttrKey('');
                                              setNewAttrValue('');
                                              setAddingAttrId(null);
                                            }
                                          }}
                                          className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm flex items-center gap-1"
                                        >
                                          <Save size={12} /> 保存
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button 
                                      onClick={() => {
                                        setAddingAttrId(product.id);
                                        setNewAttrKey('');
                                        setNewAttrValue('');
                                      }}
                                      className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-xs font-bold text-slate-400 hover:text-indigo-500 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all flex items-center justify-center gap-1"
                                    >
                                      <Plus size={14} /> 新增属性
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="text-sm text-slate-400 italic bg-slate-50 p-4 rounded-xl border border-slate-100">等待生成...</div>
                              )}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-500 mb-2">变更记录 (移除的风险项)</div>
                              <div className="bg-red-50/50 p-4 rounded-xl border border-red-100 max-h-64 overflow-y-auto">
                                {product.attributes.data?.changes && product.attributes.data.changes.length > 0 ? (
                                  <ul className="space-y-2">
                                    {product.attributes.data.changes.map((change, idx) => {
                                      const isManualAdd = change.startsWith('[手动新增]');
                                      const isManualDelete = change.startsWith('[手动删除]');
                                      return (
                                        <li key={idx} className={`text-xs flex items-start gap-2 ${isManualAdd ? 'text-emerald-600' : isManualDelete ? 'text-blue-600' : 'text-red-600'}`}>
                                          <span className={`mt-0.5 ${isManualAdd ? '' : 'line-through opacity-70'}`}>
                                            {isManualAdd ? '+' : '-'}
                                          </span>
                                          <span>{change}</span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : (
                                  <div className="text-xs text-slate-400 italic">无变更或等待生成...</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {(activeTabs[product.id] || 'seo') === 'description' && (
                        <div className="bg-white p-6 rounded-[20px] border border-gray-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                          <h4 className="text-[15px] font-semibold text-gray-900 mb-5 flex items-center gap-2 tracking-tight">
                            <StatusIcon status={product.description.status} /> 描述清洗与排版
                          </h4>
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2">
                              <div className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">PC端预览 (已自动移除违规图片)</div>
                              <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white shadow-sm h-[400px] overflow-y-auto overflow-x-hidden">
                                {product.description.data ? (
                                  <div 
                                    className="origin-top-left prose prose-sm max-w-none p-6" 
                                    style={{ zoom: 0.7 }}
                                    dangerouslySetInnerHTML={{ 
                                      __html: generateFinalHtml(
                                        product.description.data.pc1, 
                                        product.seo.data?.optimized_title || product.name, 
                                        product.marketing.data
                                      ) 
                                    }} 
                                  />
                                ) : (
                                  <div className="p-4 text-slate-400 italic text-sm">等待生成...</div>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-500 mb-2">移除的风险内容</div>
                              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100 h-[400px] overflow-y-auto">
                                {product.description.data?.changes && product.description.data.changes.length > 0 ? (
                                  <ul className="space-y-3">
                                    {product.description.data.changes.map((change, idx) => (
                                      <li key={idx} className="text-xs text-amber-700 bg-white p-2 rounded border border-amber-200 shadow-sm">
                                        {change}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="text-xs text-slate-400 italic">无风险内容或等待生成...</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {(activeTabs[product.id] || 'seo') === 'images' && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {/* Image Compliance */}
                          <div className={`bg-white p-5 rounded-2xl border border-slate-200 shadow-sm ${!enableImageRemaster ? 'lg:col-span-2' : ''}`}>
                            <div className="flex justify-between items-center mb-4">
                              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                <StatusIcon status={product.compliance.status} /> 图片合规检测 (全量)
                              </h4>
                              {product.compliance.data && (
                                editingComplianceId === product.id ? (
                                  <div className="flex gap-2">
                                    <button onClick={() => setEditingComplianceId(null)} className="px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm">取消</button>
                                    <button 
                                      onClick={() => {
                                        setEditingComplianceId(null);
                                        // Re-run removeImagesFromHtml with originalData
                                        if (product.description.originalData && product.compliance.data) {
                                          const riskyUrls = product.compliance.data.images.filter(img => img.isRisky).map(img => img.url);
                                          const removeImagesFromHtml = (html: string) => {
                                            if (!html) return html;
                                            let newHtml = html;
                                            riskyUrls.forEach(url => {
                                              const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                              const imgRegex = new RegExp(`<img[^>]*src=["']${escapedUrl}["'][^>]*>`, 'gi');
                                              newHtml = newHtml.replace(imgRegex, '');
                                            });
                                            newHtml = newHtml.replace(/<p[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/p>/gi, '');
                                            newHtml = newHtml.replace(/<div[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/div>/gi, '');
                                            newHtml = newHtml.replace(/<span[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/span>/gi, '');
                                            newHtml = newHtml.replace(/(<br\s*\/?>\s*){2,}/gi, '<br/>');
                                            return newHtml;
                                          };
                                          const updatedDesc = {
                                            ...product.description,
                                            data: {
                                              ...product.description.originalData,
                                              pc1: removeImagesFromHtml(product.description.originalData.pc1),
                                              pc2: removeImagesFromHtml(product.description.originalData.pc2),
                                              mobile1: removeImagesFromHtml(product.description.originalData.mobile1),
                                              mobile2: removeImagesFromHtml(product.description.originalData.mobile2),
                                            }
                                          };
                                          updateProduct(product.id, { description: updatedDesc });
                                          syncProductToGoogleSheets({ ...product, description: updatedDesc });
                                        }
                                      }}
                                      className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm flex items-center gap-1"
                                    >
                                      <Save size={12} /> 保存
                                    </button>
                                  </div>
                                ) : (
                                  <button 
                                    onClick={() => setEditingComplianceId(product.id)}
                                    className="px-3 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md shadow-sm transition-colors flex items-center gap-1"
                                  >
                                    <Edit2 size={12} /> 进入编辑
                                  </button>
                                )
                              )}
                            </div>
                            {product.compliance.data ? (
                              <div>
                                {product.compliance.data.hasRisk && (
                                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                                    <div className="text-xs text-red-700">
                                      <span className="font-bold block mb-0.5">发现违规图片</span>
                                      已从描述 HTML 中自动移除以下标记为违规的图片。
                                    </div>
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-3 max-h-64 overflow-y-auto p-1">
                                  {product.compliance.data.images.map((img, idx) => {
                                    const isManual = img.reason === '手动标记违规';
                                    return (
                                    <div key={idx} className="flex flex-col gap-1 w-24">
                                      <div className={`relative w-24 h-24 border rounded-xl overflow-hidden shadow-sm group ${img.isRisky ? 'border-red-500' : 'border-slate-200'}`}>
                                        <SmartImage src={img.url} alt="" className="w-full h-full object-cover" />
                                        
                                        {/* Top-left badge for risky images */}
                                        {img.isRisky && (
                                          <div className={`absolute top-0 left-0 px-1.5 py-0.5 text-[9px] font-bold text-white rounded-br-lg z-10 ${isManual ? 'bg-orange-500' : 'bg-red-500'}`}>
                                            {isManual ? '手动删除' : '违规'}
                                          </div>
                                        )}

                                        {/* Hover overlay with actions */}
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-20">
                                          <button 
                                            onClick={() => setLightboxImage(img.url)}
                                            className="px-2 py-1 bg-white/20 hover:bg-white/40 text-white text-[10px] font-medium rounded backdrop-blur-sm flex items-center gap-1 transition-colors"
                                          >
                                            <Search size={10} /> 放大
                                          </button>
                                          
                                          {editingComplianceId === product.id && (
                                            <button 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const newImages = [...product.compliance.data!.images];
                                                newImages[idx] = { ...img, isRisky: !img.isRisky, reason: !img.isRisky ? '手动标记违规' : '手动标记安全' };
                                                updateProduct(product.id, { 
                                                  compliance: { ...product.compliance, data: { ...product.compliance.data!, images: newImages, hasRisk: newImages.some(i => i.isRisky) } }
                                                });
                                              }}
                                              className={`px-2 py-1 text-[10px] font-medium rounded shadow-sm transition-colors flex items-center gap-1 ${
                                                img.isRisky 
                                                  ? 'bg-emerald-500 text-white hover:bg-emerald-600' 
                                                  : 'bg-red-500 text-white hover:bg-red-600'
                                              }`}
                                            >
                                              {img.isRisky ? <><CheckCircle2 size={10} /> 还原</> : <><Trash2 size={10} /> 违规</>}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      
                                      {/* Reason below the image */}
                                      {img.isRisky && (
                                        <div className="text-[9px] text-red-600 leading-tight text-center px-1 break-words">
                                          {isManual ? '用户手动标记移除' : img.reason || '违规移除'}
                                        </div>
                                      )}
                                    </div>
                                  )})}
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm text-slate-400 italic">等待检测...</div>
                            )}
                          </div>

                          {/* Remaster Image */}
                          {enableImageRemaster && (
                            <div className="bg-white p-6 rounded-[20px] border border-gray-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                              <div className="flex justify-between items-center mb-5">
                                <h4 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2 tracking-tight">
                                  <StatusIcon status={product.remaster.status} /> 首图重绘
                                </h4>
                                {(product.remaster.status === 'success' || product.remaster.status === 'error') && (
                                  <button
                                    onClick={() => handleManualRemaster(product)}
                                    className="text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                                  >
                                    <RefreshCcw size={12} /> {product.remaster.status === 'error' ? '重试' : '重新生成'}
                                  </button>
                                )}
                              </div>
                              <div className="flex flex-col gap-4 h-full">
                                <div className="flex items-center gap-4 w-full">
                                  <div 
                                    className="flex-1 aspect-square border border-gray-100 rounded-[18px] overflow-hidden bg-[#f5f5f7] shadow-sm p-1 cursor-pointer hover:border-indigo-300 transition-colors"
                                    onClick={() => product.image && setLightboxImage(product.image)}
                                  >
                                    {product.image && <SmartImage src={product.image} alt="Original" className="w-full h-full object-contain rounded-2xl" />}
                                  </div>
                                  <div className="flex items-center text-gray-300 flex-shrink-0"><ChevronRight size={24} /></div>
                                  <div 
                                    className="flex-1 aspect-square border border-indigo-100 rounded-[18px] overflow-hidden bg-indigo-50/50 relative shadow-sm p-1 cursor-pointer hover:border-indigo-400 transition-colors"
                                    onClick={() => product.remaster.data && setLightboxImage(product.remaster.data.remasteredUrl)}
                                  >
                                    {product.remaster.data ? (
                                      <SmartImage src={product.remaster.data.remasteredUrl} alt="Remastered" className="w-full h-full object-contain rounded-2xl" />
                                    ) : (
                                      <div className="w-full h-full flex flex-col items-center justify-center text-indigo-300 gap-2">
                                        {product.remaster.status === 'error' ? (
                                          <>
                                            <AlertCircle size={24} className="text-red-400" />
                                            <span className="text-[10px] font-medium text-red-500">重绘失败</span>
                                          </>
                                        ) : product.remaster.status === 'idle' && !enableImageRemaster ? (
                                          <>
                                            <ImageIcon size={24} className="opacity-50" />
                                            <span className="text-[10px] font-medium">已跳过</span>
                                          </>
                                        ) : (
                                          <>
                                            <ImageIcon size={24} className="opacity-50" />
                                            <span className="text-[10px] font-medium">AI 重绘中</span>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {product.remaster.data?.imgbbUrl && (
                                  <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                                    <div className="text-xs text-emerald-700 font-bold mb-1 flex items-center gap-1"><CheckCircle2 size={14}/> 已上传至图床</div>
                                    <a href={product.remaster.data.imgbbUrl} target="_blank" rel="noreferrer" className="text-[10px] text-emerald-600 hover:text-emerald-800 hover:underline break-all block">
                                      {product.remaster.data.imgbbUrl}
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Image Selection Modal */}
      {selectingImageFor && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-md flex items-center justify-center p-4 sm:p-8">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-sm sticky top-0 z-10">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 tracking-tight">更换首图</h3>
                <p className="text-sm text-gray-500 mt-1">选择一张图片作为后续 AI 重绘的原图</p>
              </div>
              <button 
                onClick={() => setSelectingImageFor(null)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-gray-50/50">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {(() => {
                  const product = products.find(p => p.id === selectingImageFor);
                  if (!product) return null;
                  const imagesStr = product.rawRow['产品图片'] || product.rawRow['图片'] || product.rawRow['Images'] || '';
                  const images = imagesStr.split(';').map((s: string) => s.trim()).filter(Boolean);
                  
                  if (images.length === 0) {
                    return <div className="col-span-full py-12 text-center text-gray-500">未找到可选图片</div>;
                  }

                  return images.map((img: string, idx: number) => {
                    const isSelected = product.image === img;
                    return (
                      <div 
                        key={idx}
                        onClick={() => {
                          updateProduct(product.id, { image: img });
                          setSelectingImageFor(null);
                        }}
                        className={`
                          relative aspect-square rounded-2xl overflow-hidden cursor-pointer bg-white border-2 transition-all duration-200
                          ${isSelected ? 'border-indigo-500 ring-4 ring-indigo-500/20 shadow-md' : 'border-transparent shadow-sm hover:shadow-md hover:scale-[1.02]'}
                        `}
                      >
                        <SmartImage src={img} alt={`Option ${idx + 1}`} className="w-full h-full object-contain p-2" />
                        {isSelected && (
                          <div className="absolute top-2 right-2 bg-indigo-500 text-white rounded-full p-1 shadow-sm">
                            <Check size={14} strokeWidth={3} />
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Overlay */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
        >
          <SmartImage
            src={lightboxImage}
            alt="Enlarged view"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
          <div className="absolute top-6 right-6 text-white/70 hover:text-white bg-black/50 rounded-full p-2 cursor-pointer transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </div>
        </div>
      )}

      {showAdmin && authUser.role === 'admin' && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );
}
