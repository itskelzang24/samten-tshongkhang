import React, { useState, useEffect, useRef, useMemo, useCallback, Component, Suspense } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  History,
  Settings,
  Search,
  Plus,
  Minus,
  Trash2,
  Printer,
  Save,
  X,
  ChevronRight,
  AlertCircle,
  Barcode,
  Phone,
  ArrowLeftRight,
  User,
  CreditCard,
  Banknote,
  CheckCircle2,
  AlertTriangle,
  Edit,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  ShieldCheck,
  Users as UsersIcon
} from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  LineChart,
  Line,
  Legend,
  Cell
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';
// Lazy-load barcode to reduce initial bundle size and speed up first paint
const BarcodeComponent = React.lazy(() => import('react-barcode'));
import { useReactToPrint } from 'react-to-print';
import { printReceipt } from './receipt/Receipt';

/**
 * UTILITIES
 */
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// API base URL — /api in production (Vercel), localhost in dev
const WEB_APP_URL = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

/**
 * TYPES
 */
interface Product {
  ID: string | number;
  Name: string;
  Category: string;
  Unit: string;
  Cost: number;
  Selling: number;
  Stock: number;
  MinStock: number;
  Vendor: string;
}

interface CartItem extends Product {
  qty: number;
  rate: number;
  lineType: 'SALE' | 'RETURN';
  gstRate: number;
}

interface Bill {
  BillNo: string;
  DateTime: string;
  CustomerName: string;
  Method: string;
  User: string;
  Subtotal: number;
  GSTTotal: number;
  GrandTotal: number;
  Status: string;
  lines?: BillLine[];
}

interface BillLine {
  BillNo: string;
  LineId: string;
  ItemID: string;
  ItemName: string;
  Qty: number;
  Rate: number;
  LineType: 'SALE' | 'RETURN';
  GST_Rate: number;
  GST_Amount: number;
  LineTotal: number;
}

interface Config {
  gst_rate: number;
  bill_prefix: string;
  bill_no_seed: number;
  staff_perms: Record<string, boolean>;
}

interface UserProfile {
  username: string;
  role: 'ADMIN' | 'STAFF';
}

/**
 * COMPONENTS
 */

const TabButton = ({ active, onClick, icon: Icon, label }: { active: boolean, onClick: () => void, icon: any, label: string }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2",
      active
        ? "text-brand border-brand bg-brand-light"
        : "text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50"
    )}
  >
    <Icon size={18} />
    <span className="hidden sm:inline">{label}</span>
  </button>
);

/**
 * ERROR BOUNDARY
 */
export class AppErrorBoundary extends (Component as any) {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-3xl flex items-center justify-center mb-6">
            <AlertCircle size={40} />
          </div>
          <h1 className="text-2xl font-black text-slate-800 mb-2">Something went wrong</h1>
          <p className="text-slate-500 max-w-md mb-8">
            The application encountered an unexpected error. Please try refreshing the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-brand text-white font-bold rounded-2xl shadow-lg shadow-brand/20 hover:scale-105 transition-all"
          >
            Refresh Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const raw = localStorage.getItem('samten_user');
      return raw ? JSON.parse(raw) as UserProfile : null;
    } catch (e) {
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pos' | 'financials' | 'inventory' | 'setup' | 'profit'>('dashboard');
  const [config, setConfig] = useState<Config | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [prefetchedBills, setPrefetchedBills] = useState<Bill[] | null>(null);

  const prefetchFinancials = useCallback(async (limit = 50, extraPages = 0) => {
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      // First page (offset 0)
      const params0 = new URLSearchParams({ action: 'listBills', start: today, end: today, limit: String(limit) }).toString();
      const res0 = await fetch(`${WEB_APP_URL}?${params0}`);
      if (!res0.ok) return;
      const data0 = await res0.json();
      if (!Array.isArray(data0)) return;
      let combined: Bill[] = data0 as Bill[];

      // Background fetch next `extraPages` pages (offset by limit each)
      for (let p = 1; p <= extraPages; p++) {
        try {
          const offset = p * limit;
          const paramsP = new URLSearchParams({ action: 'listBills', start: today, end: today, limit: String(limit), offset: String(offset) }).toString();
          const resP = await fetch(`${WEB_APP_URL}?${paramsP}`);
          if (!resP.ok) continue;
          const dataP = await resP.json();
          if (Array.isArray(dataP) && dataP.length > 0) {
            // append while avoiding duplicates (based on BillNo)
            const existing = new Set(combined.map(x => String(x.BillNo)));
            for (const row of dataP) {
              if (!existing.has(String(row.BillNo))) {
                combined.push(row as Bill);
                existing.add(String(row.BillNo));
              }
            }
          }
        } catch (err) {
          console.debug('prefetch extra page failed', err);
        }
      }

      setPrefetchedBills(combined);
    } catch (err) {
      // ignore prefetch errors
      console.debug('prefetchFinancials failed', err);
    }
  }, []);
  const [products, setProducts] = useState<Product[]>([]);
  const [dashboardData, setDashboardData] = useState<any>({ lowStock: [], chartData: [], monthlySales: [], paymentMethods: [], totalSales: 0, totalTransactions: 0, totalItemsSold: 0 });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('Walk-in Customer');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  // customerContact and transferId are captured post-sale in the post-capture modal
  const [currentUser] = useState('Admin');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null); // BillNo if editing
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [lastBill, setLastBill] = useState<Bill | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [postCaptureOpen, setPostCaptureOpen] = useState(false);
  const [postCustomerContact, setPostCustomerContact] = useState('');
  const [postTransferId, setPostTransferId] = useState('');
  const [postSaving, setPostSaving] = useState(false);
  const [returnToTab, setReturnToTab] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Save captured contact & transfer ID to the bill row using the new backend endpoint
  const handleSavePostCapture = useCallback(async () => {
    if (!lastBill) return;
    setPostSaving(true);
    try {
      const payload = {
        action: 'updateBillContact',
        billNo: lastBill.BillNo,
        customerContact: postCustomerContact || '',
        transferId: postTransferId || ''
      };
      const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data && data.success) {
        // update local lastBill so UI reflects saved values
        setLastBill(prev => prev ? ({ ...prev, CustomerContact: postCustomerContact, TransferId: postTransferId }) : prev);
        setMessage({ type: 'success', text: `Contact and transaction saved for ${lastBill.BillNo}` });
        // refresh dashboard/products in background
        try { await fetchDashboardData(); } catch (e) { console.debug('refresh after post-capture failed', e); }
        setPostCaptureOpen(false);
        setShowReceipt(false);
      } else {
        throw new Error(data && data.error ? data.error : 'Failed to save contact');
      }
    } catch (err: any) {
      console.error('Failed to save post-capture data', err);
      setMessage({ type: 'error', text: `Failed to save contact: ${err && err.message ? err.message : err}` });
    } finally {
      setPostSaving(false);
    }
  }, [lastBill, postCustomerContact, postTransferId]);

  const searchRef = useRef<HTMLDivElement>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);


  const fetchDashboardData = useCallback(async () => {
    try {
      const res = await fetch(`${WEB_APP_URL}?action=getDashboardData`);
      if (!res.ok) throw new Error('Failed to fetch dashboard data');
      const data = await res.json();
      if (data && typeof data === 'object') {
        setDashboardData({
          lowStock: Array.isArray(data.lowStock) ? data.lowStock : [],
          chartData: Array.isArray(data.chartData) ? data.chartData : [],
          monthlySales: Array.isArray(data.monthlySales) ? data.monthlySales : [],
          paymentMethods: Array.isArray(data.paymentMethods) ? data.paymentMethods : [],
          totalSales: typeof data.totalSales === 'number' ? data.totalSales : Number(data.totalSales) || 0,
          totalTransactions: typeof data.totalTransactions === 'number' ? data.totalTransactions : Number(data.totalTransactions) || 0,
          totalItemsSold: typeof data.totalItemsSold === 'number' ? data.totalItemsSold : Number(data.totalItemsSold) || 0
        });
      }
    } catch (err) {
      console.error('Dashboard data fetch error:', err);
      // Keep existing data or empty state on error
    }
  }, []);

  // Handle clicks outside search suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${WEB_APP_URL}?action=getConfig`);
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error('Failed to fetch config', err);
    }
  }, []);

  const fetchProducts = useCallback(async (q = '') => {
    try {
      const res = await fetch(`${WEB_APP_URL}?action=listProducts&q=${q}`);
      const data = await res.json();
      setProducts(data);
    } catch (err) {
      console.error('Failed to fetch products', err);
    }
  }, []);
  // Paginated fetch: if start > 0 append, otherwise replace
  const PAGE_SIZE = 100;
  const fetchProductsPaged = useCallback(async (q = '', start = 0, limit = PAGE_SIZE) => {
    try {
      const qs = new URLSearchParams({ action: 'listProducts', q: q || '', limit: String(limit), start: String(start) }).toString();
      const res = await fetch(`${WEB_APP_URL}?${qs}`);
      const data = await res.json();
      if (start && start > 0) {
        setProducts(prev => [...prev, ...data]);
      } else {
        setProducts(Array.isArray(data) ? data : []);
      }
      return data;
    } catch (err) {
      console.error('Failed to fetch products (paged)', err);
      return [];
    }
  }, []);

  // Fetch single product by ID using new API
  const fetchProductById = useCallback(async (id: string | number) => {
    try {
      const res = await fetch(`${WEB_APP_URL}?action=getProduct&productId=${encodeURIComponent(String(id))}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data || null;
    } catch (err) {
      console.error('Failed to fetch product by id', err);
      return null;
    }
  }, []);

  // Fetch initial data once on mount. We rely on stable callbacks above.
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      await Promise.all([fetchConfig(), fetchProducts(), fetchDashboardData()]);
      if (mounted) setInitialLoading(false);
    };
    init();
    return () => { mounted = false; };
  }, [fetchConfig, fetchProducts, fetchDashboardData]);

  // App-level prefetch for Financials: start loading today's transactions
  // as soon as the user is available so the Financials tab feels instant.
  // Keep older prefetch triggered on login as a background refresh - it will
  // be a no-op if LoginScreen already prefetched. Use the smaller limit here
  // so we don't add extra load on network when user is present.
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    (async () => {
      try {
        await prefetchFinancials(20);
      } catch (err) {
        console.debug('Financials background prefetch failed', err);
      }
    })();
    return () => { mounted = false; };
  }, [user, prefetchFinancials]);

  // Auto-focus the barcode/search input whenever POS is active so
  // a barcode scanner can type directly without needing a button click.
  useEffect(() => {
    if (activeTab !== 'pos') return;
    const timer = window.setTimeout(() => {
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [activeTab, isEditing]);

  const addToCart = useCallback((product: Product) => {
    if (loading) return; // prevent adding while save/update in progress
    setCart(prev => {
      const existing = prev.find(item => item.ID === product.ID && item.lineType === 'SALE');
      if (existing) {
        return prev.map(item => (item.ID === product.ID && item.lineType === 'SALE') ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { ...product, qty: 1, rate: product.Selling, lineType: 'SALE', gstRate: config?.gst_rate || 0.05 }];
    });
    setSearchQuery('');
    setShowSuggestions(false);
    window.setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 0);
  }, [config?.gst_rate, loading]);

  const updateCartQty = useCallback((id: string | number, qty: number, lineType: 'SALE' | 'RETURN') => {
    if (loading) return; // block changes while saving
    setCart(prev => {
      if (qty <= 0) return prev.filter(item => !(item.ID === id && item.lineType === lineType));
      return prev.map(item => (item.ID === id && item.lineType === lineType) ? { ...item, qty } : item);
    });
  }, [loading]);

  const updateCartRate = useCallback((id: string | number, rate: number, lineType: 'SALE' | 'RETURN') => {
    if (loading) return; // block rate changes while saving
    setCart(prev => prev.map(item => (item.ID === id && item.lineType === lineType) ? { ...item, rate } : item));
  }, [loading]);

  const toggleLineType = useCallback((id: string | number, currentType: 'SALE' | 'RETURN') => {
    if (loading) return; // block toggles while saving
    const newType = currentType === 'SALE' ? 'RETURN' : 'SALE';
    setCart(prev => prev.map(item => (item.ID === id && item.lineType === currentType) ? { ...item, lineType: newType } : item));
  }, [loading]);

  const subtotal = useMemo(() => {
    return cart.reduce((acc, item) => {
      const lineTotal = item.qty * item.rate;
      return acc + (item.lineType === 'SALE' ? lineTotal : -lineTotal);
    }, 0);
  }, [cart]);

  const gstTotal = useMemo(() => {
    return cart.reduce((acc, item) => {
      const lineTotal = item.qty * item.rate;
      const gst = lineTotal * item.gstRate;
      return acc + (item.lineType === 'SALE' ? gst : -gst);
    }, 0);
  }, [cart, config]);

  const grandTotal = subtotal + gstTotal;

  const handleCheckout = useCallback(async () => {
    if (cart.length === 0) return;
    setLoading(true);
    setMessage(null);

    try {
      let billNo = isEditing;
      if (!billNo) {
        const res = await fetch(WEB_APP_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'createBill' })
        });
        const data = await res.json();
        billNo = data.billNo;
      }

      const payload: any = {
        action: 'saveBill',
        billNo,
        customerName,
        method: paymentMethod,
        // Note: contact & transfer ID are captured post-sale via updateBillContact
        user: currentUser,
        lines: cart.map(item => ({
          itemId: item.ID,
          itemName: item.Name,
          qty: item.qty,
          rate: item.rate,
          lineType: item.lineType,
          gstRate: item.gstRate
        }))
      };
      // If we're updating an existing bill, ask backend to lock it after save
      if (isEditing) payload.lock = true;

      const saveRes = await fetch(WEB_APP_URL, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const saveData = await saveRes.json();

      if (saveData.success) {
        setMessage({ type: 'success', text: `Bill ${billNo} saved successfully!` });
        setLastBill({
          BillNo: billNo!,
          DateTime: new Date().toISOString(),
          CustomerName: customerName,
          Method: paymentMethod,
          User: currentUser,
          Subtotal: subtotal,
          GSTTotal: gstTotal,
          GrandTotal: grandTotal,
          Status: 'ACTIVE',
          lines: cart.map((item, i) => ({
            BillNo: billNo!,
            LineId: i.toString(),
            ItemID: item.ID.toString(),
            ItemName: item.Name,
            Qty: item.qty,
            Rate: item.rate,
            LineType: item.lineType,
            GST_Rate: item.gstRate,
            GST_Amount: (item.qty * item.rate) * item.gstRate,
            LineTotal: item.qty * item.rate
          }))
        });
        setShowReceipt(true);
  // Post-capture inputs are left empty by default; user may fill them after receipt
        resetPOS();
        // Refresh products and dashboard in parallel so UI reflects edits immediately
        try {
          await Promise.all([fetchProducts(), fetchDashboardData()]);
        } catch (e) {
          console.error('Failed to refresh after save', e);
        }
        // If we were editing from another tab (e.g., Financials), return there after completing
        if (returnToTab) {
          setActiveTab(returnToTab);
          setReturnToTab(null);
        }
      } else {
        throw new Error(saveData.error || 'Failed to save bill');
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [cart, customerName, paymentMethod, currentUser, isEditing, returnToTab, fetchProducts, fetchDashboardData]);

  const resetPOS = useCallback(() => {
    setCart([]);
    setCustomerName('Walk-in Customer');
    setPaymentMethod('CASH');
    setSearchQuery('');
    setIsEditing(null);
    if (returnToTab) {
      setActiveTab(returnToTab);
      setReturnToTab(null);
    } else {
      window.setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 0);
    }
  }, [returnToTab]);

  const handleBarcodeSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const barcode = searchQuery.trim();
    if (!barcode) {
      barcodeInputRef.current?.focus();
      return;
    }

    const product = products.find(p => p.ID.toString() === barcode);
    if (product) {
      addToCart(product);
      setSearchQuery('');
      setShowSuggestions(false);
    } else {
      setShowSuggestions(true);
    }

    window.setTimeout(() => {
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select();
    }, 0);
  }, [searchQuery, products, addToCart]);

  const editExistingBill = useCallback(async (billNo: string) => {
    if (!billNo || billNo === 'N/A') {
      setMessage({ type: 'error', text: 'Invalid Bill Number' });
      return;
    }
    // We'll fetch the bill first and only switch to POS if it's editable.
    setLoading(true);
    try {
      const res = await fetch(`${WEB_APP_URL}?action=getBill&billNo=${billNo}`);
      const bill = await res.json();
      if (bill && (bill.BillNo || bill['Bill No'])) {
        const actualBillNo = bill.BillNo || bill['Bill No'];
        // If the bill is locked, do not allow editing — present the bill details
        // and ask the user to explicitly reopen it first.
        if (bill.Status && String(bill.Status).toUpperCase() === 'LOCKED') {
          // Inform user and return them to Financials to reopen the bill there
          setMessage({ type: 'error', text: `Bill ${actualBillNo} is locked. Reopen it from Financials to edit.` });
          setActiveTab('financials');
          return;
        }

        // remember where we came from so we can return after editing
        setReturnToTab(activeTab);
        // Navigate to POS to perform edits
        setActiveTab('pos');
        setIsEditing(actualBillNo);
        setCustomerName(bill.CustomerName || 'Walk-in Customer');
        setPaymentMethod(bill.Method || 'CASH');
        setCart((bill.lines || []).map((l: any) => ({
          ID: l.ItemID,
          Name: l.ItemName,
          qty: l.Qty,
          rate: l.Rate,
          lineType: l.LineType || 'SALE',
          gstRate: l.GST_Rate || 0.05,
          Selling: l.Rate
        })));
        setMessage({ type: 'success', text: `Loaded bill ${actualBillNo} for editing` });
      } else {
        throw new Error('Bill not found or invalid data');
      }
    } catch (err: any) {
      console.error('Failed to load bill', err);
      setMessage({ type: 'error', text: `Failed to load bill: ${err.message}` });
      // If loading failed, and we had stored a return tab, go back
      if (returnToTab) {
        setActiveTab(returnToTab);
        setReturnToTab(null);
      }
    } finally {
      setLoading(false);
    }
  }, [setCart, setCustomerName, setPaymentMethod, setIsEditing, setMessage, setLoading, returnToTab, setActiveTab, activeTab]);

  const filteredSuggestions = useMemo(() => {
    if (!searchQuery) return [];
    const lowerQ = searchQuery.toLowerCase();
    return products.filter(p =>
      p.ID.toString().toLowerCase().includes(lowerQ) ||
      p.Name.toLowerCase().includes(lowerQ) ||
      p.Category.toLowerCase().includes(lowerQ)
    ).slice(0, 10);
  }, [searchQuery, products]);

  const handleLogout = () => {
    setUser(null);
    try { localStorage.removeItem('samten_user'); } catch (e) { /* ignore */ }
    setActiveTab('dashboard');
  };

  // keep persisted user in sync with state so refresh retains login
  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem('samten_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('samten_user');
      }
    } catch (e) {
      // ignore storage errors
    }
  }, [user]);

  // Auto-logout when idle for more than 5 minutes (300000 ms)
  useEffect(() => {
    if (!user) return;

    let idleTimeout: number | undefined;
    const LOGOUT_MS = 5 * 60 * 1000; // 5 minutes

    const doLogout = () => {
      try {
        setMessage({ type: 'error', text: 'Logged out due to inactivity' });
      } catch (e) {
        // ignore
      }
      handleLogout();
    };

    const resetTimer = () => {
      if (idleTimeout) window.clearTimeout(idleTimeout);
      idleTimeout = window.setTimeout(doLogout, LOGOUT_MS) as unknown as number;
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'click'];
    events.forEach(ev => window.addEventListener(ev, resetTimer));

    // start the timer
    resetTimer();

    return () => {
      if (idleTimeout) window.clearTimeout(idleTimeout);
      events.forEach(ev => window.removeEventListener(ev, resetTimer));
    };
  }, [user, handleLogout]);

  if (initialLoading && user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-brand/30 border-t-brand rounded-full animate-spin" />
        <p className="text-slate-500 font-bold animate-pulse">Initializing System...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} fetchConfig={fetchConfig} prefetchFinancials={prefetchFinancials} />;
  }

  const isAllowed = (tab: string) => {
    if (user.role === 'ADMIN') return true;
    // If staff_perms is empty or the tab hasn't been explicitly configured,
    // default to allowing core tabs for staff users.
    const defaultStaffTabs: Record<string, boolean> = { dashboard: true, pos: true, financials: true, inventory: true };
    const perms = config?.staff_perms;
    if (!perms || Object.keys(perms).length === 0) return defaultStaffTabs[tab] ?? false;
    return perms[tab] ?? false;
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-red-600">Samten Inventory</h1>
            </div>
          </div>

          {/* Top navigation: responsive (mobile uses overlay menu) */}

          <div className="flex items-center gap-4">
            {/* Desktop nav (md+) */}
            <nav className="hidden md:flex items-center gap-1 overflow-x-auto no-scrollbar">
              {isAllowed('dashboard') && (
                <button onClick={() => setActiveTab('dashboard')} className={cn(
                  'px-3 py-2 rounded-md transition-colors text-sm font-semibold flex items-center gap-2',
                  activeTab === 'dashboard' ? 'bg-red-700/80 text-white' : 'text-slate-500 hover:bg-slate-100'
                )}>
                  <LayoutDashboard size={18} />
                  <span className="whitespace-nowrap">Dashboard</span>
                </button>
              )}
              {isAllowed('pos') && (
                <button onClick={() => setActiveTab('pos')} className={cn(
                  'px-3 py-2 rounded-md transition-colors text-sm font-semibold flex items-center gap-2',
                  activeTab === 'pos' ? 'bg-red-700/80 text-white' : 'text-slate-500 hover:bg-slate-100'
                )}>
                  <ShoppingCart size={18} />
                  <span className="whitespace-nowrap">Point of Sale</span>
                </button>
              )}
              {isAllowed('financials') && (
                <button onClick={() => setActiveTab('financials')} className={cn(
                  'px-3 py-2 rounded-md transition-colors text-sm font-semibold flex items-center gap-2',
                  activeTab === 'financials' ? 'bg-red-700/80 text-white' : 'text-slate-500 hover:bg-slate-100'
                )}>
                  <History size={18} />
                  <span className="whitespace-nowrap">Financials</span>
                </button>
              )}
              {isAllowed('inventory') && (
                <button onClick={() => setActiveTab('inventory')} className={cn(
                  'px-3 py-2 rounded-md transition-colors text-sm font-semibold flex items-center gap-2',
                  activeTab === 'inventory' ? 'bg-red-700/80 text-white' : 'text-slate-500 hover:bg-slate-100'
                )}>
                  <Package size={18} />
                  <span className="whitespace-nowrap">Inventory</span>
                </button>
              )}
              {isAllowed('financials') && (
                <button onClick={() => setActiveTab('profit')} className={cn(
                  'px-3 py-2 rounded-md transition-colors text-sm font-semibold flex items-center gap-2',
                  activeTab === 'profit' ? 'bg-red-700/80 text-white' : 'text-slate-500 hover:bg-slate-100'
                )}>
                  <TrendingUp size={18} />
                  <span className="whitespace-nowrap">Profit Summary</span>
                </button>
              )}
              {user.role === 'ADMIN' && (
                <button onClick={() => setActiveTab('setup')} className={cn(
                  'px-3 py-2 rounded-md transition-colors text-sm font-semibold flex items-center gap-2',
                  activeTab === 'setup' ? 'bg-red-700/80 text-white' : 'text-slate-500 hover:bg-slate-100'
                )}>
                  <Settings size={18} />
                  <span className="whitespace-nowrap">Setup</span>
                </button>
              )}
            </nav>

            {/* Mobile menu button (shown on small screens) */}
            <button
              onClick={() => setMobileMenuOpen(v => !v)}
              className="md:hidden p-2 rounded-md bg-white border border-slate-200 text-slate-600"
              aria-label="Open menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                {mobileMenuOpen ? (
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                ) : (
                  <path fillRule="evenodd" d="M3 5h14a1 1 0 010 2H3a1 1 0 110-2zm0 4h14a1 1 0 010 2H3a1 1 0 110-2zm0 4h14a1 1 0 010 2H3a1 1 0 110-2z" clipRule="evenodd" />
                )}
              </svg>
            </button>

            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm font-semibold text-slate-700">{user.username}</span>
              <span className="text-[10px] text-brand font-bold uppercase">{user.role}</span>
            </div>
            <button
              onClick={handleLogout}
              className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200 hover:bg-red-50 hover:text-red-600 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile navigation overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm md:hidden">
          <div className="absolute top-0 right-0 left-0 p-4 bg-white shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Menu</h3>
              <button onClick={() => setMobileMenuOpen(false)} className="p-2 rounded-md text-slate-600 border border-slate-200 bg-white">
                <X size={18} />
              </button>
            </div>
            <nav className="mt-4 space-y-2">
              {isAllowed('dashboard') && <button onClick={() => { setActiveTab('dashboard'); setMobileMenuOpen(false); }} className={cn('w-full text-left px-4 py-2 rounded-md', activeTab === 'dashboard' ? 'bg-red-700/80 text-white' : 'text-slate-700 hover:bg-slate-50')}>Dashboard</button>}
              {isAllowed('pos') && <button onClick={() => { setActiveTab('pos'); setMobileMenuOpen(false); }} className={cn('w-full text-left px-4 py-2 rounded-md', activeTab === 'pos' ? 'bg-red-700/80 text-white' : 'text-slate-700 hover:bg-slate-50')}>POS</button>}
              {isAllowed('financials') && <button onClick={() => { setActiveTab('financials'); setMobileMenuOpen(false); }} className={cn('w-full text-left px-4 py-2 rounded-md', activeTab === 'financials' ? 'bg-red-700/80 text-white' : 'text-slate-700 hover:bg-slate-50')}>Financials</button>}
              {isAllowed('financials') && <button onClick={() => { setActiveTab('profit'); setMobileMenuOpen(false); }} className={cn('w-full text-left px-4 py-2 rounded-md', activeTab === 'profit' ? 'bg-red-700/80 text-white' : 'text-slate-700 hover:bg-slate-50')}>Profit Summary</button>}
              {isAllowed('inventory') && <button onClick={() => { setActiveTab('inventory'); setMobileMenuOpen(false); }} className={cn('w-full text-left px-4 py-2 rounded-md', activeTab === 'inventory' ? 'bg-red-700/80 text-white' : 'text-slate-700 hover:bg-slate-50')}>Inventory</button>}
              {user.role === 'ADMIN' && <button onClick={() => { setActiveTab('setup'); setMobileMenuOpen(false); }} className={cn('w-full text-left px-4 py-2 rounded-md', activeTab === 'setup' ? 'bg-red-700/80 text-white' : 'text-slate-700 hover:bg-slate-50')}>Setup</button>}
            </nav>
          </div>
        </div>
      )}

      <div className="flex">
        <main className="flex-1">
          <div className="max-w-7xl mx-auto p-4 md:p-6">
            {activeTab === 'dashboard' && isAllowed('dashboard') && (
              <DashboardTab
                data={dashboardData}
                onRefresh={fetchDashboardData}
                onGoToInventory={() => setActiveTab('inventory')}
                userRole={user?.role}
              />
            )}
            {activeTab === 'pos' && isAllowed('pos') && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* LEFT: SEARCH & CART */}
                <div className="lg:col-span-8 space-y-6">
                  {isEditing && (
                    <div className="bg-brand-light border border-brand-border p-3 rounded-xl flex items-center justify-between animate-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-brand text-white rounded-lg flex items-center justify-center">
                          <Edit size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-brand uppercase tracking-wider">Editing Mode</p>
                          <p className="text-sm font-black text-slate-800">Bill No: {isEditing}</p>
                        </div>
                      </div>
                      <button
                        onClick={resetPOS}
                        className="px-3 py-1.5 bg-white border border-brand-border text-brand text-[10px] font-bold rounded-lg hover:bg-brand hover:text-white transition-all uppercase"
                      >
                        Cancel Edit
                      </button>
                    </div>
                  )}
                  {/* SEARCH BAR */}
                  <div className="relative" ref={searchRef}>
                    <form onSubmit={handleBarcodeSearch} className="relative group">
                      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-brand transition-colors">
                        <Search size={20} />
                      </div>
                      <input
                        ref={barcodeInputRef}
                        autoFocus={activeTab === 'pos'}
                        name="productSearch"
                        type="text"
                        placeholder="Scan barcode or search products (ID, Name, Category)..."
                        className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-lg"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setShowSuggestions(true);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                      />
                      <button
                        type="button"
                        onClick={() => barcodeInputRef.current?.focus()}
                        className="absolute inset-y-2 right-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl flex items-center gap-2 text-sm font-medium transition-colors"
                      >
                        <Barcode size={18} />
                        <span className="hidden sm:inline">Focus Scanner</span>
                      </button>
                    </form>

                    {/* SUGGESTIONS DROPDOWN */}
                    {showSuggestions && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="p-2 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider px-2">Products</span>
                          <span className="text-[10px] text-slate-400 px-2">{filteredSuggestions.length} results</span>
                        </div>
                        <div className="max-h-[400px] overflow-y-auto">
                          {filteredSuggestions.length > 0 ? (
                            (filteredSuggestions || []).map((p) => (
                              <button
                                key={p.ID}
                                onClick={() => addToCart(p)}
                                disabled={loading}
                                title={loading ? 'Update in progress' : undefined}
                                className={cn(
                                  "w-full flex items-center justify-between p-4 transition-colors border-b border-slate-50 last:border-0 group",
                                  loading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-brand-light'
                                )}
                              >
                                <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-brand-light group-hover:text-brand transition-colors">
                                    <Package size={20} />
                                  </div>
                                  <div className="text-left">
                                    <p className="font-semibold text-slate-800">{p.Name}</p>
                                    <p className="text-xs text-slate-500">{p.Category} • {p.Unit}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="font-bold text-brand">Nu. {p.Selling.toFixed(2)}</p>
                                  <p className={cn("text-[10px] font-bold uppercase", p.Stock <= p.MinStock ? "text-red-500" : "text-slate-400")}>
                                    Stock: {p.Stock}
                                  </p>
                                </div>
                              </button>
                            ))
                          ) : (products.length === 0) ? (
                            // Show skeleton suggestions while products are loading
                            <div className="p-2 space-y-2">
                              {Array.from({ length: 4 }).map((_, i) => (
                                <div key={`suggest-skel-${i}`} className="flex items-center justify-between gap-4 p-3 border-b border-slate-50 last:border-0 animate-pulse">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-slate-200 rounded-lg" />
                                    <div className="space-y-1">
                                      <div className="h-3 bg-slate-200 rounded w-40" />
                                      <div className="h-2 bg-slate-200 rounded w-24" />
                                    </div>
                                  </div>
                                  <div className="space-y-1 text-right">
                                    <div className="h-3 bg-slate-200 rounded w-16 ml-auto" />
                                    <div className="h-2 bg-slate-200 rounded w-12 ml-auto" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-4 text-sm text-slate-500">No products found</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* CART TABLE */}
                  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <ShoppingCart size={18} className="text-brand" />
                        Current Cart
                        {isEditing && <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded-full uppercase font-bold">Editing: {isEditing}</span>}
                      </h3>
                      <span className="text-xs font-medium text-slate-500">{cart.length} items</span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-slate-400 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                            <th className="px-6 py-4">Item Details</th>
                            <th className="px-6 py-4">Type</th>
                            <th className="px-6 py-4 text-center">Quantity</th>
                            <th className="px-6 py-4 text-right">Rate</th>
                            <th className="px-6 py-4 text-right">Total</th>
                            <th className="px-6 py-4"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {(!cart || cart.length === 0) ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                                <div className="flex flex-col items-center gap-3">
                                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-200">
                                    <ShoppingCart size={32} />
                                  </div>
                                  <p className="font-medium">Your cart is empty</p>
                                  <p className="text-xs">Scan items or search to add them to the bill</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            cart.map((item, idx) => (
                              <tr key={`${item.ID}-${item.lineType}-${idx}`} className="group hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4">
                                  <p className="font-semibold text-slate-800">{item.Name}</p>
                                  <p className="text-[10px] text-slate-400 font-medium">ID: {item.ID} • {item.Category}</p>
                                </td>
                                <td className="px-6 py-4">
                                  <button
                                    onClick={() => toggleLineType(item.ID, item.lineType)}
                                    disabled={loading}
                                    title={loading ? 'Update in progress' : undefined}
                                    className={cn(
                                      "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all",
                                      item.lineType === 'SALE' ? "bg-brand-light text-brand" : "bg-red-100 text-red-700",
                                      loading ? 'opacity-60 cursor-not-allowed' : (item.lineType === 'SALE' ? 'hover:bg-brand-border' : 'hover:bg-red-200')
                                    )}
                                  >
                                    {item.lineType}
                                  </button>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center justify-center gap-3">
                                    <button
                                      onClick={() => updateCartQty(item.ID, item.qty - 1, item.lineType)}
                                      disabled={loading}
                                      title={loading ? 'Update in progress' : undefined}
                                      className={cn(
                                        "w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center transition-all",
                                        loading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white hover:border-brand hover:text-brand'
                                      )}
                                    >
                                      <Minus size={14} />
                                    </button>
                                    <span className="w-8 text-center font-bold text-slate-700">{item.qty}</span>
                                    <button
                                      onClick={() => updateCartQty(item.ID, item.qty + 1, item.lineType)}
                                      disabled={loading}
                                      title={loading ? 'Update in progress' : undefined}
                                      className={cn(
                                        "w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center transition-all",
                                        loading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white hover:border-brand hover:text-brand'
                                      )}
                                    >
                                      <Plus size={14} />
                                    </button>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-slate-400">Nu.</span>
                                    <input
                                      type="number"
                                      name={`rate-${item.ID}-${item.lineType}`}
                                      className={cn(
                                        "w-20 text-right font-bold text-slate-700 bg-transparent border-b border-transparent focus:border-brand outline-none transition-all p-1",
                                        loading ? 'opacity-60 cursor-not-allowed' : 'hover:border-slate-200'
                                      )}
                                      value={item.rate}
                                      onChange={(e) => updateCartRate(item.ID, parseFloat(e.target.value) || 0, item.lineType)}
                                      disabled={loading}
                                      title={loading ? 'Update in progress' : undefined}
                                    />
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <p className={cn("font-bold", item.lineType === 'SALE' ? "text-slate-800" : "text-red-600")}>
                                    {item.lineType === 'RETURN' && '-'}Nu. {(item.qty * item.rate).toFixed(2)}
                                  </p>
                                  <p className="text-[10px] text-slate-400 font-medium">GST: Nu. {(item.qty * item.rate * item.gstRate).toFixed(2)}</p>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <button
                                    onClick={() => updateCartQty(item.ID, 0, item.lineType)}
                                    disabled={loading}
                                    title={loading ? 'Update in progress' : undefined}
                                    className={cn(
                                      "p-2 text-slate-300 transition-colors opacity-0 group-hover:opacity-100",
                                      loading ? 'opacity-60 cursor-not-allowed' : 'hover:text-red-500'
                                    )}
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* RIGHT: BILL SUMMARY */}
                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden sticky top-24">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <Save size={18} className="text-brand" />
                        Checkout Summary
                      </h3>
                    </div>

                    <div className="p-6 space-y-6">
                      {/* CUSTOMER & PAYMENT */}
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label htmlFor="customerName" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Customer Name</label>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                              <User size={16} />
                            </div>
                            <input
                              id="customerName"
                              type="text"
                              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium"
                              value={customerName}
                              onChange={(e) => setCustomerName(e.target.value)}
                            />
                          </div>
                        </div>

                        {/* Customer contact removed from inline checkout; captured post-sale */}

                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Payment Method</label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => setPaymentMethod('CASH')}
                              className={cn(
                                "flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all",
                                paymentMethod === 'CASH'
                                  ? "bg-brand border-brand text-white shadow-lg shadow-brand-light"
                                  : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                              )}
                            >
                              <Banknote size={16} />
                              CASH
                            </button>
                            <button
                              onClick={() => setPaymentMethod('QR')}
                              className={cn(
                                "flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all",
                                paymentMethod === 'QR'
                                  ? "bg-brand border-brand text-white shadow-lg shadow-brand-light"
                                  : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                              )}
                            >
                              <Barcode size={16} />
                              QR
                            </button>
                          </div>
                        </div>

                        {/* Transfer / transaction ID for non-cash payments */}
                        {/* Transaction ID removed from inline checkout; captured post-sale */}
                      </div>

                      <div className="h-px bg-slate-100" />

                      {/* TOTALS */}
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500 font-medium">Subtotal</span>
                          <span className="text-slate-800 font-bold">Nu. {subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500 font-medium">GST Total</span>
                          <span className="text-slate-800 font-bold">Nu. {gstTotal.toFixed(2)}</span>
                        </div>
                        <div className="pt-3 border-t border-slate-100 flex justify-between items-end">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold uppercase text-brand tracking-wider">Grand Total</span>
                            <span className="text-3xl font-black text-slate-900 tracking-tight">Nu. {grandTotal.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {/* ACTIONS */}
                      <div className="space-y-3 pt-4">
                        <button
                          disabled={cart.length === 0 || loading}
                          onClick={handleCheckout}
                          title={loading ? 'Update in progress' : (cart.length === 0 ? 'Add items to enable checkout' : undefined)}
                          className={cn(
                            "w-full py-4 rounded-2xl flex items-center justify-center gap-3 text-lg font-black tracking-tight transition-all shadow-xl",
                            // If cart is empty, show disabled grey style. If loading or active, keep brand color.
                            cart.length === 0
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                              : (loading
                                ? "bg-brand text-white shadow-brand-light cursor-not-allowed opacity-70"
                                : "bg-brand text-white hover:bg-brand-hover shadow-brand-light active:scale-[0.98]")
                          )}
                        >
                          {loading ? (
                            // Spinner shown on brand background for clear feedback
                            <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <>
                              <CheckCircle2 size={24} />
                              {isEditing ? 'UPDATE BILL' : 'COMPLETE SALE'}
                            </>
                          )}
                        </button>

                        {isEditing && (
                          <button
                            onClick={resetPOS}
                            className="w-full py-3 rounded-xl border border-slate-200 text-slate-500 font-bold text-sm hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                          >
                            <X size={18} />
                            CANCEL EDIT
                          </button>
                        )}
                      </div>

                      {message && (
                        <div className={cn(
                          "p-4 rounded-xl flex items-start gap-3 animate-in fade-in zoom-in duration-300",
                          message.type === 'success' ? "bg-brand-light text-brand border border-brand-border" : "bg-red-50 text-red-700 border border-red-100"
                        )}>
                          {message.type === 'success' ? <CheckCircle2 size={20} className="shrink-0" /> : <AlertCircle size={20} className="shrink-0" />}
                          <p className="text-sm font-medium">{message.text}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'financials' && (
              <FinancialsTab onEdit={editExistingBill} onNotify={setMessage} prefetchedBills={prefetchedBills} />
            )}

            {activeTab === 'profit' && isAllowed('financials') && (
              <ProfitTab />
            )}

            {activeTab === 'inventory' && isAllowed('inventory') && (
              <InventoryTab currentUser={currentUser} onRefresh={async () => { await Promise.all([fetchProducts(), fetchDashboardData()]); }} products={products} />
            )}

            {activeTab === 'setup' && user.role === 'ADMIN' && (
              <SetupTab config={config} onRefresh={fetchConfig} />
            )}
          </div>
        </main>
      </div>

      {/* RECEIPT MODAL */}
      {showReceipt && lastBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">Sale Completed</h3>
              <button onClick={() => setShowReceipt(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="p-8">
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-center">
                <div className="w-14 h-14 bg-brand-light text-brand rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={28} />
                </div>
                <h4 className="text-2xl font-black text-slate-900">Nu. {lastBill.GrandTotal.toFixed(2)}</h4>
                <p className="text-sm text-slate-500 font-medium">Bill No: <span className="text-slate-800 font-bold">{lastBill.BillNo}</span></p>
                <p className="text-xs text-slate-400">{format(new Date(lastBill.DateTime), 'PPpp')}</p>
                {lastBill.CustomerContact && <p className="text-xs text-slate-400">Contact: <span className="text-slate-800">{lastBill.CustomerContact}</span></p>}
                {lastBill.TransferId && <p className="text-xs text-slate-400">Txn ID: <span className="text-slate-800">{lastBill.TransferId}</span></p>}
              </div>

              <div className="mt-8 space-y-3">
                <button
                  onClick={() => lastBill && printReceipt({
                    bill_no: lastBill.BillNo,
                    date: format(new Date(lastBill.DateTime), 'dd/MM/yyyy HH:mm'),
                    customer: lastBill.CustomerName,
                    user: lastBill.User,
                    items: (lastBill.lines || []).map((l: any) => ({ name: l.ItemName, qty: l.Qty, price: l.Rate, gst: (l.GST_Rate || 0) > 0 })),
                    subtotal: lastBill.Subtotal,
                    gst_total: lastBill.GSTTotal,
                    grand_total: lastBill.GrandTotal,
                    payment_method: lastBill.Method,
                  })}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
                >
                  <Printer size={20} />
                  PRINT RECEIPT
                </button>
                <button
                  onClick={() => setPostCaptureOpen(true)}
                  className="w-full py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all"
                >
                  DONE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* POST-SALE CAPTURE MODAL: collect contact & transfer id after receipt */}
      {postCaptureOpen && lastBill && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">Capture Contact & Transaction</h3>
              <button onClick={() => { setPostCaptureOpen(false); setShowReceipt(false); }} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-500">Enter customer contact (phone/email) and bank transfer transaction ID for bill <span className="font-bold">{lastBill.BillNo}</span>.</p>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Customer Contact</label>
                <input type="text" value={postCustomerContact} onChange={(e) => setPostCustomerContact(e.target.value)} placeholder="Phone or email (optional)" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Transaction ID</label>
                <input type="text" value={postTransferId} onChange={(e) => setPostTransferId(e.target.value)} placeholder="Bank transfer / transaction ID (optional)" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
              </div>

              <div className="flex gap-3 pt-4">
                <button onClick={() => { setPostCaptureOpen(false); setShowReceipt(false); }} className="flex-1 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all">Skip</button>
                <button onClick={handleSavePostCapture} disabled={postSaving} className={cn("flex-1 py-3 rounded-xl font-bold shadow-lg shadow-brand-light flex items-center justify-center gap-2 transition-all", postSaving ? 'bg-brand text-white opacity-60 cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-hover')}>{postSaving ? 'Saving...' : 'Save & Close'}</button>
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

/**
 * LOGIN SCREEN
 */
function LoginScreen({ onLogin, fetchConfig, prefetchFinancials }: { onLogin: (user: UserProfile) => void, fetchConfig: () => void, prefetchFinancials?: (limit?: number, extraPages?: number) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Prefetch Financials while the login screen is visible to improve
    // perceived performance when the user opens Financials after login.
    try {
      if (prefetchFinancials) prefetchFinancials(50, 2);
    } catch (err) {
      // ignore
    }
  }, [prefetchFinancials]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${WEB_APP_URL}?action=login&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);
      const data = await res.json();
      if (data && data.success && data.user) {
        const u: UserProfile = { username: data.user.username, role: data.user.role };
        onLogin(u);
        fetchConfig();
      } else {
        setError(data?.error || 'Invalid username or password');
        setLoading(false);
      }
    } catch (err: any) {
      setError('Login failed: ' + (err?.message || String(err)));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-500">
        <div className="bg-brand p-8 text-center text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-black/10 pointer-events-none" />
          <div className="relative z-10">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-md">
              <Lock size={32} />
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white">Samten Inventory</h2>
            <p className="text-white/70 text-sm font-medium">Please sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="p-8 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2 animate-in slide-in-from-top-2">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="loginUsername" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Username</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                <User size={18} />
              </div>
              <input
                required
                id="loginUsername"
                name="username"
                type="text"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all font-medium"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="loginPassword" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                <ShieldCheck size={18} />
              </div>
              <input
                required
                id="loginPassword"
                name="password"
                type={showPassword ? 'text' : 'password'}
                className="w-full pl-10 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all font-medium"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(s => !s)}
                className="absolute inset-y-0 right-3 flex items-center text-slate-500 hover:text-slate-700 transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            disabled={loading}
            onClick={() => { /* click handled by form submit */ }}
            title={loading ? 'Signing in...' : undefined}
            className={cn(
              "w-full py-4 rounded-2xl font-black text-lg shadow-xl flex items-center justify-center gap-3 transition-all",
              loading
                ? "bg-brand text-white shadow-brand-light opacity-60 cursor-not-allowed"
                : "bg-brand text-white hover:bg-brand-hover active:scale-[0.98] shadow-brand-light"
            )}
          >
            {loading ? <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : 'SIGN IN'}
          </button>

          <p className="text-center text-xs text-slate-400 font-medium">
            Forgot password? Contact your administrator.
          </p>
        </form>
      </div>
    </div>
  );
}

/**
 * SETUP TAB
 */
function SetupTab({ config, onRefresh }: { config: Config | null, onRefresh: () => void }) {
  const [loading, setLoading] = useState(false);
  const [perms, setPerms] = useState<Record<string, boolean>>(config?.staff_perms || {});

  const [gstPercent, setGstPercent] = useState<number>((config?.gst_rate || 0) * 100);
  const [billPrefix, setBillPrefix] = useState<string>(config?.bill_prefix || '');

  useEffect(() => {
    if (config) setPerms(config.staff_perms);
    if (config) {
      setGstPercent((config.gst_rate || 0) * 100);
      setBillPrefix(config.bill_prefix || '');
    }
  }, [config]);

  const handleSavePerms = async () => {
    setLoading(true);
    try {
      const res = await fetch(WEB_APP_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'updatePermissions', perms })
      });
      const data = await res.json();
      if (data.success) {
        onRefresh();
        alert('Permissions updated successfully!');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const togglePerm = (tab: string) => {
    setPerms({ ...perms, [tab]: !perms[tab] });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-black text-slate-800 tracking-tight">System Settings</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-brand-light text-brand rounded-xl flex items-center justify-center">
              <UsersIcon size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">Staff Permissions</h3>
              <p className="text-xs text-slate-500">Control which modules staff can access</p>
            </div>
          </div>

          <div className="space-y-3">
            {['dashboard', 'pos', 'financials', 'inventory'].map((tab) => (
              <label key={tab} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer hover:bg-white hover:border-brand-border transition-all group">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
                    perms[tab] ? "bg-brand border-brand" : "bg-white border-slate-200"
                  )}>
                    {perms[tab] && <CheckCircle2 size={12} className="text-white" />}
                  </div>
                  <span className="text-sm font-bold text-slate-700 capitalize">{tab}</span>
                </div>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={perms[tab] || false}
                  onChange={() => togglePerm(tab)}
                />
              </label>
            ))}
          </div>

          <button
            disabled={loading}
            onClick={handleSavePerms}
            title={loading ? 'Saving permissions...' : undefined}
            className={cn(
              "mt-6 w-full py-3 rounded-xl font-bold shadow-lg shadow-brand-light transition-all flex items-center justify-center gap-2",
              loading ? 'bg-brand text-white opacity-60 cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-hover'
            )}
          >
            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
            <span className="ml-2">SAVE PERMISSIONS</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center">
              <Settings size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">General Config</h3>
              <p className="text-xs text-slate-500">System-wide parameters</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">GST Rate (%)</label>
              <input
                name="gstPercent"
                type="number"
                min={0}
                max={100}
                step={0.01}
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700"
                value={gstPercent}
                onChange={(e) => setGstPercent(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Bill Prefix</label>
              <input
                name="billPrefix"
                type="text"
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700"
                value={billPrefix}
                onChange={(e) => setBillPrefix(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <button
              disabled={loading}
              title={loading ? 'Saving configuration...' : undefined}
              onClick={async () => {
                setLoading(true);
                try {
                  // Convert percent to decimal
                  const gstDecimal = (isNaN(gstPercent) ? 0 : gstPercent) / 100;
                  const res = await fetch(WEB_APP_URL, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'updateConfig', gst_rate: gstDecimal, bill_prefix: billPrefix })
                  });
                  const data = await res.json();
                  if (data && data.success) {
                    onRefresh();
                    alert('General configuration updated successfully');
                  } else {
                    throw new Error(data && data.error ? data.error : 'Failed to update config');
                  }
                } catch (err) {
                  console.error(err);
                  alert('Failed to save configuration: ' + (err && err.message ? err.message : err));
                } finally {
                  setLoading(false);
                }
              }}
              className={cn(
                "flex-1 py-3 rounded-xl font-bold shadow-lg shadow-brand-light flex items-center justify-center gap-2 transition-all",
                loading ? 'bg-brand text-white opacity-60 cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-hover'
              )}
            >
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
              <span className="ml-2">SAVE CONFIG</span>
            </button>
            <button onClick={() => { if (config) { setGstPercent((config.gst_rate || 0) * 100); setBillPrefix(config.bill_prefix || ''); } }} className="py-3 px-4 bg-white border border-slate-200 rounded-xl font-bold">RESET</button>
          </div>
          <p className="mt-3 text-[10px] text-slate-400 italic">Advanced settings can also be modified directly in the <code>System_Config</code> sheet.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * DASHBOARD TAB
 */
function DashboardTab({ data, onRefresh, onGoToInventory, userRole }: { data: any, onRefresh: () => void, onGoToInventory: () => void, userRole?: string }) {
  const COLORS = ['#f24153', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
  const PAYMENT_COLORS: Record<string, string> = {
    'QR': '#3b82f6',
    'CASH': '#ef4444',
    'UNKNOWN': '#9ca3af'
  };
  const [isReady, setIsReady] = useState(false);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartCanRender, setChartCanRender] = useState(false);

  useEffect(() => {
    // Delay rendering chart to ensure container dimensions are settled
    const timer = setTimeout(() => setIsReady(true), 300);
    return () => clearTimeout(timer);
  }, []);

  // Ensure the chart container has non-zero dimensions before rendering the chart.
  useEffect(() => {
    if (!isReady) return;
    let mounted = true;

    const measure = () => {
      const el = chartRef.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const tryMeasure = () => {
      let attempts = 0;
      const attempt = () => {
        attempts += 1;
        if (!mounted) return;
        if (measure()) {
          setChartCanRender(true);
          return;
        }
        if (attempts < 6) requestAnimationFrame(attempt);
        else setChartCanRender(true); // fallback
      };
      requestAnimationFrame(attempt);
    };

    const t = window.setTimeout(tryMeasure, 40);
    return () => { mounted = false; clearTimeout(t); };
  }, [isReady]);

  // Defensive checks
  const chartData = Array.isArray(data?.chartData) ? data.chartData : [];
  const lowStock = Array.isArray(data?.lowStock) ? data.lowStock : [];

  // Non-admin (staff) simplified dashboard: show only stock alerts, total transactions, and total items sold
  if (userRole && userRole !== 'ADMIN') {
    const lowStockArr = lowStock || [];
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Overview</h2>
            <p className="text-sm text-slate-500 font-medium">Quick summary</p>
          </div>
          <button onClick={onRefresh} className="p-2 hover:bg-white rounded-xl border border-slate-200 text-slate-500 transition-all">
            <History size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col">
            <span className="text-xs text-slate-500 uppercase font-bold">Stock Alerts</span>
            <span className="text-2xl font-black text-slate-900 mt-2">{lowStockArr.length}</span>
            <span className="text-[11px] text-slate-400 mt-2">Items at or below minimum stock</span>

            {lowStockArr.length > 0 ? (
              <ul className="mt-3 text-sm space-y-1">
                {lowStockArr.slice(0, 8).map((p, i) => {
                  const stock = Number(p.Stock || 0);
                  const min = Number(p.MinStock || 0);
                  const healthy = stock > min;
                  const pillClass = healthy ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800';
                  const pillLabel = healthy ? 'OK' : (stock <= 0 ? 'OUT' : 'LOW');
                  return (
                    <li key={i} className="flex items-center justify-between text-slate-700">
                      <span className="truncate pr-2">{p.Name || p.ID || '(Unnamed Item)'}</span>
                      <div className="flex items-center space-x-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pillClass}`}>{pillLabel}</span>
                        <span className="text-xs text-slate-500">{stock} / {min}</span>
                      </div>
                    </li>
                  );
                })}
                {lowStockArr.length > 8 ? (
                  <li className="text-xs text-slate-400">and {lowStockArr.length - 8} more...</li>
                ) : null}
              </ul>
            ) : (
              <div className="mt-3 text-sm text-slate-500">No low-stock items</div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col">
            <span className="text-xs text-slate-500 uppercase font-bold">Total Transactions</span>
            <span className="text-2xl font-black text-slate-900 mt-2">{data?.totalTransactions || 0}</span>
            <span className="text-[11px] text-slate-400 mt-2">Completed bills</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col">
            <span className="text-xs text-slate-500 uppercase font-bold">Total Items Sold</span>
            <span className="text-2xl font-black text-slate-900 mt-2">{data?.totalItemsSold || 0}</span>
            <span className="text-[11px] text-slate-400 mt-2">Units sold (Active)</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Business Overview</h2>
          <p className="text-sm text-slate-500 font-medium">Real-time insights into your supermarket performance</p>
        </div>
        <button
          onClick={onRefresh}
          className="p-2 hover:bg-white rounded-xl border border-slate-200 text-slate-500 transition-all"
        >
          <History size={20} />
        </button>
      </div>

      {/* SUMMARY METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col">
          <span className="text-xs text-slate-500 uppercase font-bold">Total Sales</span>
          <span className="text-2xl font-black text-slate-900 mt-2">Nu. {(data?.totalSales || 0).toFixed ? (data.totalSales).toFixed(2) : Number(data?.totalSales || 0).toFixed(2)}</span>
          <span className="text-[11px] text-slate-400 mt-2">Since inception (Active bills)</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col">
          <span className="text-xs text-slate-500 uppercase font-bold">Total Transactions</span>
          <span className="text-2xl font-black text-slate-900 mt-2">{data?.totalTransactions || 0}</span>
          <span className="text-[11px] text-slate-400 mt-2">Completed bills</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col">
          <span className="text-xs text-slate-500 uppercase font-bold">Total Items Sold</span>
          <span className="text-2xl font-black text-slate-900 mt-2">{data?.totalItemsSold || 0}</span>
          <span className="text-[11px] text-slate-400 mt-2">Units sold (Active)</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* MONTHLY SALES TREND */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp size={18} className="text-brand" />
              Monthly Sales Trend
            </h3>
            <span className="text-[10px] font-bold uppercase text-slate-400 bg-slate-50 px-2 py-1 rounded">Last months</span>
          </div>

          <div className="w-full mb-4 h-56 sm:h-72 lg:h-96" ref={chartRef} style={{ minWidth: 0, minHeight: 0 }}>
            {chartCanRender && Array.isArray(data?.monthlySales) && data.monthlySales.length > 0 ? (
              (() => {
                const sales = Array.isArray(data.monthlySales) ? data.monthlySales : [];
                // Determine the year to display on the X-axis. If the data contains a year token (e.g. "Mar 2026"), use that year.
                let year = new Date().getFullYear();
                if (sales.length > 0 && typeof sales[0].name === 'string') {
                  const m = String(sales[0].name).trim().match(/(\d{4})$/);
                  if (m && m[1]) year = Number(m[1]);
                }

                // Build a full 12-month series for the chosen year. For months with no sales data, value will be null
                // so Recharts will leave gaps (no connecting line) instead of plotting zeros.
                const months = Array.from({ length: 12 }).map((_, i) => ({
                  name: format(new Date(year, i, 1), 'MMM yyyy'),
                  monthIndex: i
                }));

                const fullData = months.map(m => {
                  const found = sales.find((s: any) => String(s.name) === m.name);
                  return { name: m.name, value: found ? Number(found.value) : 0 };
                });

                return (
                  <ResponsiveContainer width="100%" height="100%">
                    {/* Show all 12 months on the X-axis; null values create gaps (no connecting lines) */}
                    {/* Increase right margin and right padding so the last tick label (Dec) is fully visible */}
                    <LineChart data={fullData} margin={{ top: 10, right: 40, left: 0, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="name"
                        type="category"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#94a3b8', fontSize: 10 }}
                        interval={0} // 🔥 force ALL labels to show
                        angle={window.innerWidth < 640 ? -35 : 0}
                        textAnchor={window.innerWidth < 640 ? 'end' : 'middle'}
                        height={window.innerWidth < 640 ? 60 : 30}
                        padding={{ left: 0, right: 12 }}
                        tickFormatter={(value: string) => {
                          // show short month always (better for mobile)
                          return String(value).split(' ')[0]; // Jan, Feb, Mar...
                        }}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `Nu. ${v}`} width={56} />
                      <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 12px -6px rgb(0 0 0 / 0.08)' }} formatter={(value: any) => (typeof value === 'number' ? `Nu. ${Number(value).toFixed(2)}` : value)} labelFormatter={(label: string) => label} />
                      <Line connectNulls={true} type="monotone" dataKey="value" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} isAnimationActive animationDuration={700} animationEasing="ease-out" />
                    </LineChart>
                  </ResponsiveContainer>
                );
              })()
            ) : (!data?.monthlySales || data.monthlySales.length === 0) ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <TrendingUp size={48} className="opacity-10 mb-2" />
                <p className="text-sm font-medium">No monthly sales data available</p>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-slate-100 border-t-brand rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* (Payment method panel moved to the right column) */}
        </div>

        {/* RIGHT COLUMN: STOCK ALERTS + PAYMENT METHOD DISTRIBUTION */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <AlertTriangle size={18} className="text-brand" />
                Stock Alerts
              </h3>
              <span className="bg-brand-light text-brand text-[10px] font-bold px-2 py-1 rounded-full">
                {lowStock.length} ITEMS
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {lowStock.length > 0 ? (
                lowStock.map((item: any) => (
                  <div key={item.ID} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between group hover:border-brand-border transition-all">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{item.Name}</p>
                      <p className="text-[10px] text-slate-400 font-medium uppercase">{item.Category}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-brand">{item.Stock} <span className="text-[10px] font-bold text-slate-400">/ {item.MinStock}</span></p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Left</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-6">
                  <CheckCircle2 size={48} className="text-brand mb-4 opacity-20" />
                  <p className="text-slate-400 text-sm font-medium">All items are well stocked!</p>
                </div>
              )}
            </div>

            <button
              onClick={onGoToInventory}
              className="mt-6 w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
            >
              MANAGE INVENTORY
              <ChevronRight size={16} />
            </button>
          </div>

          {/* PAYMENT METHOD DISTRIBUTION */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <CreditCard size={18} className="text-brand" />
                Payment Method Distribution
              </h3>
              <span className="text-[10px] font-bold uppercase text-slate-400">Revenue share</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-36 h-36" style={{ minWidth: 0, minHeight: 0 }}>
                {Array.isArray(data?.paymentMethods) && data.paymentMethods.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.paymentMethods} dataKey="value" nameKey="name" innerRadius={28} outerRadius={56} paddingAngle={4}>
                        {data.paymentMethods.map((entry: any, idx: number) => (
                          <Cell key={`cell-pm-${idx}`} fill={PAYMENT_COLORS[(String(entry.name) || '').toUpperCase()] || (COLORS[idx % COLORS.length])} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any) => `Nu. ${Number(value).toFixed(2)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-sm text-slate-400">No payment data</div>
                )}
              </div>

              <div className="flex-1">
                {Array.isArray(data?.paymentMethods) && data.paymentMethods.length > 0 ? (
                  <div className="space-y-3">
                    {data.paymentMethods.map((m: any, i: number) => (
                      <div key={`pm-legend-${i}`} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded" style={{ backgroundColor: PAYMENT_COLORS[(String(m.name) || '').toUpperCase()] || COLORS[i % COLORS.length] }} />
                          <div className="text-sm font-medium text-slate-700">{m.name}</div>
                        </div>
                        <div className="text-sm font-bold text-slate-900">Nu. {(Number(m.value) || 0).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * FINANCIALS TAB
 */
function FinancialsTab({ onEdit, onNotify, prefetchedBills }: { onEdit: (billNo: string) => void, onNotify: (m: { type: 'success' | 'error', text: string } | null) => void, prefetchedBills?: Bill[] | null }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  // initialLoading is true only for the very first page load to distinguish
  // an empty-result state from "we're still fetching". This prevents the
  // incorrect "No transactions found" message showing while the first
  // network request is in-flight.
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  // Keep the date inputs blank by default (like Profit tab) but default
  // fetch to today's transactions when filters are empty.
  const [startDate, setStartDate] = useState<string>(() => '');
  const [endDate, setEndDate] = useState<string>(() => '');
  const [billSearch, setBillSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const searchDebounce = useRef<number | null>(null);
  const fetchController = useRef<AbortController | null>(null);
  const PAGE_SIZE = 50; // regular page size for subsequent loads
  const INITIAL_PAGE_SIZE = 20; // smaller first page for faster first paint

  useEffect(() => {
    // On mount, prefer prefetched bills for instant UX. If we have
    // prefetched data (loaded at App-level), use it immediately and then
    // refresh in the background. Otherwise, perform the smaller initial
    // fetch as before.
    (async () => {
      setStartIndex(0);
      if (prefetchedBills && prefetchedBills.length > 0) {
        const normalized = (prefetchedBills as any[]).map((b: any) => ({
          ...b,
          GrandTotal: (b.GrandTotal !== undefined && b.GrandTotal !== null) ? Number(b.GrandTotal) : 0,
          Subtotal: (b.Subtotal !== undefined && b.Subtotal !== null) ? Number(b.Subtotal) : 0,
          GSTTotal: (b.GSTTotal !== undefined && b.GSTTotal !== null) ? Number(b.GSTTotal) : 0,
        }));
        setBills(normalized as Bill[]);
        setInitialLoading(false);
        // Background refresh to ensure freshest data
        await fetchBills({ startDate, endDate, start: 0 });
      } else {
        setInitialLoading(true);
        await fetchBills({ startDate, endDate, start: 0, limit: INITIAL_PAGE_SIZE, initial: true });
        setInitialLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the date range changes and there's no bill search active, refresh results (debounced)
  useEffect(() => {
    if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    // If user is searching by bill number, don't override with date-range fetch
    if (billSearch) return;
    searchDebounce.current = window.setTimeout(() => {
      fetchBills({ startDate, endDate });
    }, 250);
    return () => {
      if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const fetchBills = async (opts?: { startDate?: string; endDate?: string; billNo?: string; start?: number; limit?: number; initial?: boolean }) => {
    const start = opts?.start || 0;
    const limit = opts?.limit || PAGE_SIZE;
    // if this is the initial fetch, keep initialLoading true (it is set by
    // the caller). We still set `loading` so existing logic (e.g., skeleton)
    // behaves as before.
    if (start === 0) setLoading(true);
    else setLoadingMore(true);

    // cancel previous ongoing request
    if (fetchController.current) {
      try { fetchController.current.abort(); } catch (e) { /* ignore */ }
    }
    fetchController.current = new AbortController();

    try {
      const params: Record<string, string> = { action: 'listBills', limit: String(limit) };
      // If the caller didn't provide explicit start/end, default to today's date
      // so that an empty UI date field still shows today's transactions.
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      // When fetching pages by offset, pass `offset`. If date filters exist,
      // include `start` and `end` as date-range filters. Prefers explicit
      // offset for pagination.
      if (start && start > 0) params.offset = String(start);
      if (opts?.billNo) {
        params.billNo = opts.billNo;
      } else {
        // Prefer explicit filters when provided, otherwise default to today
        params.start = opts?.startDate || startDate || todayStr;
        params.end = opts?.endDate || endDate || todayStr;
      }
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`${WEB_APP_URL}?${qs}`, { signal: fetchController.current.signal });
      if (!res.ok) throw new Error('Failed to fetch bills');
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];

      // Minimal normalization: cast numeric fields only.
      const normalized = list.map((b: any) => ({
        ...b,
        GrandTotal: (b.GrandTotal !== undefined && b.GrandTotal !== null) ? Number(b.GrandTotal) : 0,
        Subtotal: (b.Subtotal !== undefined && b.Subtotal !== null) ? Number(b.Subtotal) : 0,
        GSTTotal: (b.GSTTotal !== undefined && b.GSTTotal !== null) ? Number(b.GSTTotal) : 0,
      }));

      if (start && start > 0) {
        setBills(prev => [...prev, ...normalized]);
      } else {
        setBills(normalized);
      }

      setHasMore(normalized.length === limit);
      setStartIndex(start + normalized.length);
      return normalized;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return [];
      }
      console.error(err);
      if (start === 0) setBills([]);
      return [];
    } finally {
      if (start === 0) setLoading(false);
      else setLoadingMore(false);
    }
  };

  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    // Ensure DateTime is exported in a consistent local format so Excel shows the
    // correct transaction time (avoid timezone/ISO string mismatches).
    const exportData = bills.map(b => ({
      BillNo: getBillNo(b),
      DateTime: b.DateTime ? format(new Date(b.DateTime), 'yyyy-MM-dd HH:mm') : '',
      Customer: (b.CustomerName || b.Customer || ''),
      Total: (b.GrandTotal !== undefined ? Number(b.GrandTotal) : ''),
      Subtotal: (b.Subtotal !== undefined ? Number(b.Subtotal) : ''),
      GSTTotal: (b.GSTTotal !== undefined ? Number(b.GSTTotal) : ''),
      Status: b.Status || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Financials");
    XLSX.writeFile(workbook, "Financial_Report.xlsx");
  };

  // Debounced bill search: when billSearch changes, query remote for matching bill number
  useEffect(() => {
    if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    // If search string is empty, show date range results
    if (!billSearch) {
      // small delay to avoid double-calls
      searchDebounce.current = window.setTimeout(() => { setStartIndex(0); fetchBills({ startDate, endDate, start: 0 }); }, 250);
      return;
    }
    searchDebounce.current = window.setTimeout(() => {
      // when searching by bill number, reset to first page
      setStartIndex(0);
      fetchBills({ billNo: billSearch, start: 0 });
    }, 250);
    return () => { if (searchDebounce.current) window.clearTimeout(searchDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billSearch]);

  const getBillNo = (bill: any) => bill?.BillNo || bill?.['Bill No'] || bill?.billNo || 'N/A';

  const handleSelectBill = async (bill: Bill) => {
    setSelectedBill(bill);
    setSelectedLoading(true);
    const billNo = getBillNo(bill);
    try {
      const res = await fetch(`${WEB_APP_URL}?action=getBill&billNo=${billNo}`);
      const fullBill = await res.json();
      if (fullBill && getBillNo(fullBill) === billNo) {
        setSelectedBill(fullBill);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSelectedLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Financial History</h2>
        <div className="flex gap-3">
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all"
          >
            <Save size={18} />
            EXPORT EXCEL
          </button>
          <button
            onClick={() => fetchBills({ startDate, endDate })}
            disabled={loading}
            className={cn(
              'px-3 py-2 rounded-lg flex items-center gap-2 border transition-all',
              loading ? 'bg-white border-slate-200 text-slate-400 cursor-not-allowed' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
            title={loading ? 'Fetching...' : 'Refresh transactions'}
          >
            {loading ? <div className="w-4 h-4 border-2 border-slate-200 border-t-brand rounded-full animate-spin" /> : <History size={18} />}
            <span className="hidden sm:inline">Fetch</span>
          </button>
        </div>
      </div>

      {/* Filters: date range and bill number search */}
      <div className="mt-4 mb-2 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="filterStartDate" className="text-xs text-slate-500 mr-2">Start</label>
          <input id="filterStartDate" name="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <label htmlFor="filterEndDate" className="text-xs text-slate-500 ml-3 mr-2">End</label>
          <input id="filterEndDate" name="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button
            onClick={() => fetchBills({ startDate, endDate })}
            disabled={loading}
            className={cn(
              'ml-3 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2',
              loading ? 'bg-brand/70 text-white cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-hover'
            )}
            title={loading ? 'Fetching...' : 'Fetch transactions'}
          >
            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <History size={14} />}
            <span className="hidden sm:inline">{loading ? 'Fetching' : 'Fetch'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            name="billSearch"
            type="search"
            placeholder="Search by Bill No"
            value={billSearch}
            onChange={(e) => setBillSearch(e.target.value.toUpperCase().trim())}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          {billSearch && (
            <button onClick={() => { setBillSearch(''); fetchBills({ startDate, endDate }); }} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm">Clear</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100 bg-slate-50/50">
                  <th className="px-6 py-4">Bill No</th>
                  <th className="px-6 py-4">Date & Time</th>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4 text-right">Total</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(loading || initialLoading) ? (
                  // Skeleton rows give a smoother loading experience
                  <>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`skeleton-${i}`} className="animate-pulse">
                        <td className="px-6 py-4">
                          <div className="h-4 bg-slate-200 rounded w-24" />
                        </td>
                        <td className="px-6 py-4">
                          <div className="h-4 bg-slate-200 rounded w-20" />
                        </td>
                        <td className="px-6 py-4">
                          <div className="h-4 bg-slate-200 rounded w-40" />
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="h-4 bg-slate-200 rounded w-16 ml-auto" />
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="h-4 bg-slate-200 rounded w-12 mx-auto" />
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="h-4 bg-slate-200 rounded w-6 ml-auto" />
                        </td>
                      </tr>
                    ))}
                  </>
                ) : (bills && bills.length > 0) ? (bills || []).map((bill, idx) => (
                  <tr
                    key={`${getBillNo(bill)}-${idx}`}
                    className={cn(
                      "group hover:bg-slate-50 transition-colors cursor-pointer",
                      getBillNo(selectedBill) === getBillNo(bill) && "bg-brand-light"
                    )}
                    onClick={() => handleSelectBill(bill)}
                  >
                    <td className="px-6 py-4 font-bold text-slate-800">{getBillNo(bill)}</td>
                    <td className="px-6 py-4 text-slate-500">{bill.DateTime ? format(new Date(bill.DateTime), 'dd MMM, HH:mm') : '-'}</td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-700">{bill.CustomerName}</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">{bill.Method}</p>
                    </td>
                    <td className="px-6 py-4 text-right font-black text-slate-900">Nu. {bill.GrandTotal.toFixed(2)}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="px-2 py-1 bg-brand-light text-brand text-[10px] font-bold rounded-full uppercase">
                        {bill.Status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(getBillNo(bill));
                        }}
                        className="p-2 text-slate-400 hover:text-brand hover:bg-brand/10 rounded-lg transition-all active:scale-95"
                        title="Edit Bill"
                      >
                        <Edit size={18} />
                      </button>
                    </td>
                  </tr>
                )) : (
                  (!loading && !initialLoading) ? (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400">No transactions found for the selected range.</td></tr>
                  ) : null
                )}
                {hasMore && (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center">
                      <button
                        onClick={() => fetchBills({ startDate, endDate, start: startIndex })}
                        disabled={loadingMore}
                        className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold hover:bg-slate-50"
                      >
                        {loadingMore ? 'Loading...' : 'Load more'}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-4">
          {selectedBill ? (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in slide-in-from-right-4 duration-300">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-bold text-slate-800">Bill Details</h3>
                <div className="flex items-center gap-2">
                  {selectedBill.Status && String(selectedBill.Status).toUpperCase() === 'LOCKED' ? (
                    <button
                      onClick={async () => {
                        try {
                          setSelectedLoading(true);
                          const res = await fetch(WEB_APP_URL, {
                            method: 'POST',
                            body: JSON.stringify({ action: 'reopenBill', billNo: getBillNo(selectedBill) })
                          });
                          const data = await res.json();
                          if (data && data.success) {
                            onNotify && onNotify({ type: 'success', text: `Bill ${getBillNo(selectedBill)} reopened for editing` });
                            // Now invoke edit flow to load into POS
                            onEdit(getBillNo(selectedBill));
                          } else {
                            onNotify && onNotify({ type: 'error', text: data?.error || 'Failed to reopen bill' });
                          }
                        } catch (err: any) {
                          console.error('Failed to reopen bill', err);
                          onNotify && onNotify({ type: 'error', text: `Failed to reopen bill: ${err.message || err}` });
                        } finally {
                          setSelectedLoading(false);
                        }
                      }}
                      className="p-1.5 text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-all flex items-center gap-1 text-[10px] font-bold uppercase"
                    >
                      <Lock size={14} />
                      REOPEN
                    </button>
                  ) : (
                    <button
                      onClick={() => onEdit(getBillNo(selectedBill))}
                      className="p-1.5 text-brand hover:bg-brand/10 rounded-lg transition-all flex items-center gap-1 text-[10px] font-bold uppercase"
                    >
                      <Edit size={14} />
                      EDIT
                    </button>
                  )}
                  <span className="text-xs font-bold text-brand">{getBillNo(selectedBill)}</span>
                </div>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Customer</p>
                    <p className="text-sm font-bold text-slate-800">{selectedBill.CustomerName}</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Method</p>
                    <p className="text-sm font-bold text-slate-800">{selectedBill.Method}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase text-slate-500">User</p>
                    <p className="text-sm font-bold text-slate-800">{selectedBill.User}</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Date</p>
                    <p className="text-sm font-bold text-slate-800">{format(new Date(selectedBill.DateTime), 'PP')}</p>
                  </div>
                </div>

                {/* Contact & Transfer ID (if present) */}
                {(selectedBill.CustomerContact || selectedBill.TransferId) && (
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-500">Contact</p>
                      <p className="text-sm font-bold text-slate-800">{selectedBill.CustomerContact || '-'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Transaction ID</p>
                      <p className="text-sm font-bold text-slate-800">{selectedBill.TransferId || '-'}</p>
                    </div>
                  </div>
                )}

                <div className="h-px bg-slate-100" />

                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase text-slate-500">Items Summary</p>
                  {selectedLoading ? (
                    <div className="h-24 flex items-center justify-center">
                      <div className="w-6 h-6 border-4 border-slate-100 border-t-brand rounded-full animate-spin" />
                    </div>
                  ) : selectedBill.lines && selectedBill.lines.length > 0 ? (
                    <div className="space-y-2">
                      {selectedBill.lines.map((line, idx) => (
                        <div key={`${getBillNo(selectedBill)}-line-${idx}`} className="flex justify-between text-xs p-2 bg-slate-50 rounded-lg border border-slate-100">
                          <div className="flex gap-2">
                            <span className="font-bold text-slate-400">{line.Qty}x</span>
                            <span className="text-slate-700">{line.ItemName}</span>
                          </div>
                          <span className="font-bold">Nu. {line.LineTotal.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">
                      <p className="text-xs text-slate-500 italic">No items available for this bill.</p>
                    </div>
                  )}
                </div>

                <div className="pt-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="font-bold">Nu. {selectedBill.Subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">GST Total</span>
                    <span className="font-bold">Nu. {selectedBill.GSTTotal.toFixed(2)}</span>
                  </div>
                  <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-sm font-bold text-slate-800">Grand Total</span>
                    <span className="text-xl font-black text-brand">Nu. {selectedBill.GrandTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-100 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
              <History size={48} className="mx-auto text-slate-300 mb-4" />
              <p className="text-slate-500 font-medium">Select a bill to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * PROFIT SUMMARY TAB
 */
function ProfitTab() {
  const [loading, setLoading] = useState(true);
  const [profit, setProfit] = useState<any>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  // store month inputs in server-friendly yyyy-MM (from native month picker). mmYYYYToServer will still accept MM/YYYY if pasted.
  const [startMonth, setStartMonth] = useState<string | null>(null);
  const [endMonth, setEndMonth] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const monthDisplay = (m: string | null) => {
    if (!m) return '';
    // accept either server format yyyy-MM or user format MM/YYYY
    try {
      if (m.includes('-')) {
        const parts = m.split('-');
        const year = Number(parts[0]);
        const month = Number(parts[1]) - 1;
        return format(new Date(year, month, 1), 'MM/dd/yyyy');
      }
      if (m.includes('/')) {
        const parts = m.split('/');
        const month = Number(parts[0]) - 1;
        const year = Number(parts[1]);
        return format(new Date(year, month, 1), 'MM/dd/yyyy');
      }
      return m;
    } catch (e) { return m; }
  };

  const mmYYYYToServer = (m: string | null) => {
    if (!m) return null;
    // accept MM/YYYY or M/YYYY
    const cleaned = m.trim();
    if (cleaned.includes('/')) {
      const parts = cleaned.split('/').map(p => p.trim());
      if (parts.length !== 2) return null;
      const mm = Number(parts[0]);
      const yyyy = Number(parts[1]);
      if (!mm || !yyyy) return null;
      if (mm < 1 || mm > 12) return null;
      return `${yyyy}-${String(mm).padStart(2, '0')}`;
    }
    // fallback: if already in yyyy-MM
    if (cleaned.includes('-')) return cleaned;
    return null;
  };
  const fetchProfit = useCallback(async (opts?: { startMonth?: string | null; endMonth?: string | null }) => {
    // Abort previous fetch if in-flight
    try {
      if (fetchControllerRef.current) {
        try { fetchControllerRef.current.abort(); } catch (e) { /* ignore */ }
      }
      const controller = new AbortController();
      fetchControllerRef.current = controller;
      setChartLoading(true);
      setProfit(null);

      const params = new URLSearchParams({ action: 'getProfitData' });
      // opts may be user-facing (MM/YYYY) or server-facing (yyyy-MM). Normalize to server yyyy-MM
      const s = mmYYYYToServer(opts?.startMonth ?? startMonth);
      const e = mmYYYYToServer(opts?.endMonth ?? endMonth);
      if (s) params.set('startMonth', s);
      if (e) params.set('endMonth', e);
      const res = await fetch(`${WEB_APP_URL}?${params.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to fetch profit data');
      const data = await res.json();
      setProfit(data);
    } catch (err: any) {
      if (err && err.name === 'AbortError') {
        // fetch was aborted; no action
        return;
      }
      console.error('fetchProfit error', err);
      setProfit(null);
    } finally {
      setChartLoading(false);
      fetchControllerRef.current = null;
    }
  }, [startMonth, endMonth]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await fetchProfit({ startMonth, endMonth });
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; if (fetchControllerRef.current) { try { fetchControllerRef.current.abort(); } catch (e) { } } };
  }, [fetchProfit]);

  // compute profit based solely on revenue and cogs
  const revenue = Number(profit?.totalRevenue || 0);
  const cogs = Number(profit?.cogs || 0);
  const net = revenue - cogs;
  const margin = revenue > 0 ? (net / revenue) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Profit Summary</h2>
        <button
          onClick={() => fetchProfit()}
          disabled={loading}
          className={cn(
            'px-3 py-2 rounded-lg flex items-center gap-2 border transition-all',
            loading ? 'bg-white border-slate-200 text-slate-400 cursor-not-allowed' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          )}
          title={loading ? 'Refreshing...' : 'Refresh profit data'}
        >
          {loading ? <div className="w-4 h-4 border-2 border-slate-200 border-t-brand rounded-full animate-spin" /> : <History size={18} />}
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <label htmlFor="profitStartMonth" className="text-sm text-slate-500">Start month</label>
          <input
            id="profitStartMonth"
            type="month"
            value={startMonth || ''}
            onChange={(e) => setStartMonth(e.target.value || null)}
            className="px-3 py-2 border rounded-lg text-sm"
          />
          <label htmlFor="profitEndMonth" className="text-sm text-slate-500">End month</label>
          <input
            id="profitEndMonth"
            type="month"
            value={endMonth || ''}
            onChange={(e) => setEndMonth(e.target.value || null)}
            className="px-3 py-2 border rounded-lg text-sm"
          />
          <button
            onClick={async () => {
              setApplying(true);
              try {
                // Validate before fetching
                const s = mmYYYYToServer(startMonth);
                const e = mmYYYYToServer(endMonth);
                if ((startMonth && !s) || (endMonth && !e)) {
                  alert('Please enter months in MM/YYYY format (e.g. 03/2026)');
                } else {
                  await fetchProfit({ startMonth, endMonth });
                }
              } finally { setApplying(false); }
            }}
            disabled={applying}
            className={cn(
              'px-3 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2',
              applying ? 'bg-brand/70 text-white cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-hover'
            )}
            title={applying ? 'Applying filters...' : 'Apply filters'}
          >
            {applying ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <History size={16} />}
            <span className="hidden sm:inline">{applying ? 'Applying' : 'Apply'}</span>
          </button>
          {/* show selected range in human-readable format for consistency */}
          {(startMonth || endMonth) && (
            <div className="text-sm text-slate-500 ml-2">
              {monthDisplay(startMonth) || '—'} &nbsp;—&nbsp; {monthDisplay(endMonth) || '—'}
            </div>
          )}
        </div>

        {loading ? (
          <div className="h-32 flex items-center justify-center"><div className="w-6 h-6 border-4 border-slate-100 border-t-brand rounded-full animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500 uppercase font-bold">Total Revenue</div>
              <div className="text-2xl font-black">Nu. {revenue.toFixed(2)}</div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500 uppercase font-bold">Total Cost (COGS)</div>
              <div className="text-2xl font-black">Nu. {cogs.toFixed(2)}</div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500 uppercase font-bold">Profit (Revenue − Cost)</div>
              <div className="text-2xl font-black">Nu. {net.toFixed(2)}</div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500 uppercase font-bold">Margin</div>
              <div className="text-2xl font-black">{margin.toFixed(1)}%</div>
            </div>
          </div>
        )}
      </div>
      {!loading && (
        <div>
          <ProfitTrendChart data={profit?.monthlyProfit} loading={chartLoading} />
        </div>
      )}
    </div>
  );
}

/**
 * PROFIT TREND CHART
 * Render a monthly profit line chart below the summary cards with hover markers
 */
function ProfitTrendChart({ data, loading }: { data: Array<{ month: string; name: string; profit: number }> | undefined, loading?: boolean }) {
  // Show a lightweight skeleton while loading
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="text-lg font-bold mb-3">Profit Trend (monthly)</h3>
        <div className="w-full h-56 sm:h-72 lg:h-96 flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-slate-100 border-t-brand rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 text-center text-sm text-slate-500">No profit data available for the selected period.</div>
    );
  }

  // Memoize full-year construction to avoid re-computation on every render when data hasn't changed
  const fullData = React.useMemo(() => {
    const sales = Array.isArray(data) ? data : [];
    let year = new Date().getFullYear();
    if (sales.length > 0 && typeof sales[0].name === 'string') {
      const m = String(sales[0].name).trim().match(/(\d{4})$/);
      if (m && m[1]) year = Number(m[1]);
    }
    const months = Array.from({ length: 12 }).map((_, i) => ({ name: format(new Date(year, i, 1), 'MMM yyyy'), monthIndex: i }));
    return months.map(m => {
      const found = sales.find((s: any) => String(s.name) === m.name);
      return { name: m.name, profit: found ? Number(found.profit) : 0 };
    });
  }, [data]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
      <h3 className="text-lg font-bold mb-3">Profit Trend (monthly)</h3>
      <div className="w-full h-56 sm:h-72 lg:h-96">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={fullData} margin={{ top: 10, right: 40, left: 0, bottom: 12 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="name"
              type="category"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: window.innerWidth < 640 ? 9 : 11 }}
              interval={0} // 🔥 force ALL months to show
              angle={window.innerWidth < 640 ? -35 : 0}
              textAnchor={window.innerWidth < 640 ? 'end' : 'middle'}
              height={window.innerWidth < 640 ? 60 : 30}
              padding={{ left: 0, right: 12 }}
              tickFormatter={(value: string) => {
                return String(value).split(' ')[0]; // Jan, Feb, Mar...
              }}
            />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `Nu. ${v}`} width={56} />
            <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 12px -6px rgb(0 0 0 / 0.08)' }} formatter={(value: any) => (typeof value === 'number' ? `Nu. ${Number(value).toFixed(2)}` : value)} labelFormatter={(label: string) => label} />
            <Line connectNulls={true} type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} isAnimationActive animationDuration={700} animationEasing="ease-out" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * INVENTORY TAB
 */
function InventoryTab({ products, onRefresh, currentUser }: { products: Product[], onRefresh: () => void, currentUser: string | null }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editAction, setEditAction] = useState<'update' | 'restock'>('update');
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedCat, setSelectedCat] = useState('');
  const [barcodeToPrint, setBarcodeToPrint] = useState<string | null>(null);
  const barcodeRef = useRef<HTMLDivElement>(null);
  const [printProduct, setPrintProduct] = useState<Product | null>(null);
  const [labelsPerSheet, setLabelsPerSheet] = useState<number>(2); // 1 or 2 labels per physical sheet
  // Labels batch printing: array of label objects. Each label may contain productId or explicit name/price/barcodeText
  type LabelData = { productId?: string; name?: string; price?: string | number; meta?: string; barcodeText?: string };
  const [labelsToPrint, setLabelsToPrint] = useState<LabelData[] | null>(null);

  // Inventory search state (search by ID or Name)
  const [inventorySearch, setInventorySearch] = useState('');

  const filteredProducts = useMemo(() => {
    if (!inventorySearch) return products;
    const q = inventorySearch.toLowerCase();
    return products.filter(p =>
      String(p.ID).toLowerCase().includes(q) ||
      (p.Name || '').toLowerCase().includes(q)
    );
  }, [inventorySearch, products]);

  const handlePrintBarcode = useReactToPrint({ contentRef: barcodeRef, documentTitle: `Barcode_${barcodeToPrint || 'Label'}` });

  // Print an array of labels (two labels per sheet). This reuses the hidden barcode print area.
  const printLabels = useCallback((labels: LabelData[]) => {
    if (!labels || !labels.length) return;
    setLabelsToPrint(labels);
    // Give React a tick to render the print area
    setTimeout(() => {
      try { handlePrintBarcode(); } catch (e) { console.error('printLabels failed', e); }
      // cleanup after a short delay
      setTimeout(() => setLabelsToPrint(null), 500);
    }, 250);
  }, [handlePrintBarcode]);

  function renderSheetLabel(d: LabelData) {
    // Render a single 1.5in x 1in label block; if d contains productId, resolve product
    const prod = d.productId ? products.find(p => String(p.ID) === String(d.productId)) : null;
    const name = prod ? prod.Name : (d.name || '');
    const price = prod ? `Nu. ${Number(prod.Selling).toFixed(2)}` : (d.price ? String(d.price) : '');
    const barcodeText = d.barcodeText || (prod ? String(prod.ID) : '');
    return (
      <div key={barcodeText + name} style={{ width: '1.5in', height: '1.0in', boxSizing: 'border-box', border: '0.35pt solid #000', padding: '0.03in', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'Calibri, Arial, sans-serif', color: '#000' }}>
        {/* Barcode (small), then compact name and price under it */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <React.Suspense fallback={<div style={{height: 22}} />}>
            <BarcodeComponent value={barcodeText || ''} width={1} height={22} displayValue={false} margin={0} />
          </React.Suspense>
        </div>
          <div style={{ textAlign: 'center', marginTop: '0.01in' }}>
          <div style={{ fontSize: '8.5px', fontWeight: 700, lineHeight: '9px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
          <div style={{ fontSize: '8px', fontWeight: 700, lineHeight: '9px', color: '#0f172a' }}>{price}</div>
        </div>
      </div>
    );
  }

  // When barcodeToPrint changes, ensure we have the product data to render
  // in the hidden print area. If the product isn't present in the current
  // `products` array (paged fetch), fetch the single product from the
  // backend using the `getProduct` endpoint. Once product data is ready,
  // trigger the print. This makes printing robust when using pagination.
  useEffect(() => {
    if (!barcodeToPrint) {
      setPrintProduct(null);
      return;
    }

    let mounted = true;
    const triggerPrint = () => {
      const t = setTimeout(() => {
        try { handlePrintBarcode(); } catch (e) { console.error(e); }
      }, 250);
      return () => clearTimeout(t);
    };

    // Try to find the product in the currently loaded products first.
    const existing = products.find(p => String(p.ID) === String(barcodeToPrint));
    if (existing) {
      setPrintProduct(existing);
      return triggerPrint();
    }

    // Otherwise fetch the single product via the API.
    (async () => {
      try {
        const res = await fetch(`${WEB_APP_URL}?action=getProduct&productId=${encodeURIComponent(String(barcodeToPrint))}`);
        if (!mounted) return;
        if (!res.ok) return;
        const data = await res.json();
        setPrintProduct(data || null);
        if (mounted) {
          triggerPrint();
        }
      } catch (err) {
        console.error('Failed to fetch product for printing', err);
      }
    })();

    return () => { mounted = false; };
  }, [barcodeToPrint, products, handlePrintBarcode]);

  const printBarcode = useCallback((id: string) => {
    setBarcodeToPrint(id);
  }, []);

  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(products);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
    XLSX.writeFile(workbook, "Inventory_List.xlsx");
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${WEB_APP_URL}?action=listCategories`);
      const data = await res.json();
      setCategories(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const categoryRaw = formData.get('pCat') as string;
    const category = categoryRaw && categoryRaw.trim() ? categoryRaw.trim() : 'General';

    const parseNum = (v: FormDataEntryValue | null, fallback = 0) => {
      if (v === null) return fallback;
      const n = parseFloat(String(v));
      return isNaN(n) ? fallback : n;
    };

    const product = {
      // ID is generated by backend; pass empty string or undefined
      ID: '',
      Name: String(formData.get('pName') || '').trim(),
      Category: category,
      Unit: String(formData.get('pUnit') || 'Pcs'),
      Cost: parseNum(formData.get('pCost'), 0),
      Selling: parseNum(formData.get('pSell'), 0),
      Stock: parseNum(formData.get('pStock'), 0),
      MinStock: parseNum(formData.get('pMin'), 0),
      Vendor: String(formData.get('pVendor') || 'General')
    };

    if (!product.Name) {
      alert('Product name is required');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'saveProduct', product })
      });
      const data = await res.json();
      console.debug('saveProduct response', data);
      if (data && data.success) {
        // If user wanted to record this as a purchase, post a purchase transaction
        const formData2 = new FormData(form);
        const asPurchase = !!formData2.get('pAsPurchase');
        const billNo = (formData2.get('pBill') as string) || `PUR-${Date.now()}`;
        const vendor = (formData2.get('pVendor') as string) || product.Vendor || 'General';
        const qty = Number(product.Stock) || 0;
        const cost = Number(product.Cost) || 0;
        if (asPurchase && qty > 0) {
          try {
            await fetch(WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'postPurchase', billNo, supplier: vendor, items: [{ itemId: data.id || product.ID, itemName: product.Name, qty, cost }], user: currentUser }) });
          } catch (err) {
            console.error('Failed to post purchase for new product', err);
          }
        }

        setShowAddModal(false);
        setSelectedCat('');
        try { await onRefresh(); } catch (e) { console.error('onRefresh failed', e); }
        fetchCategories();
      } else {
        console.error('saveProduct failed', data);
        alert('Failed to save product: ' + (data && data.error ? data.error : 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCategoryOnly = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const categoryName = formData.get('categoryName') as string;

    try {
      const res = await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'addCategory', categoryName })
      });
      const data = await res.json();
      if (data.success) {
        setShowAddCategoryModal(false);
        await fetchCategories();
        setSelectedCat(categoryName);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Inventory Management</h2>
          <p className="text-sm text-slate-500 font-medium">{products.length} products in catalog</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Labels per sheet</span>
            <div className="inline-flex rounded-lg bg-slate-50 p-1 border border-slate-100">
              <button
                onClick={() => setLabelsPerSheet(1)}
                title="Print 1 label per sheet"
                className={cn(
                  "px-3 py-1 text-sm font-bold rounded-md transition-all",
                  labelsPerSheet === 1 ? 'bg-brand text-white' : 'text-slate-600 hover:bg-white'
                )}
              >
                1
              </button>
              <button
                onClick={() => setLabelsPerSheet(2)}
                title="Print 2 labels per sheet"
                className={cn(
                  "px-3 py-1 text-sm font-bold rounded-md transition-all",
                  labelsPerSheet === 2 ? 'bg-brand text-white' : 'text-slate-600 hover:bg-white'
                )}
              >
                2
              </button>
            </div>
          </div>

          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all"
          >
            <Save size={18} />
            EXPORT EXCEL
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl font-bold shadow-lg shadow-brand-light hover:bg-brand-hover transition-all active:scale-[0.98]"
          >
            <Plus size={18} />
            ADD PRODUCT
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <Search size={16} />
          <input
            name="inventorySearch"
            value={inventorySearch}
            onChange={(e) => setInventorySearch(e.target.value)}
            placeholder="Search inventory by ID or name..."
            className="flex-1 bg-transparent outline-none text-sm"
            aria-label="Search inventory"
          />
          {inventorySearch && (
            <button onClick={() => setInventorySearch('')} className="text-slate-400 hover:text-slate-600">Clear</button>
          )}
        </div>
        {/* Desktop/table view */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4">ID / Barcode</th>
                <th className="px-6 py-4">Product Name</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4 text-right">Cost</th>
                <th className="px-6 py-4 text-right">Selling</th>
                <th className="px-6 py-4 text-center">Stock</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {products.length === 0 ? (
                // Inventory skeleton rows while product list is empty/loading
                <>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`inv-skel-${i}`} className="animate-pulse">
                      <td className="px-6 py-4">
                        <div className="h-4 bg-slate-200 rounded w-24" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 bg-slate-200 rounded w-40" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 bg-slate-200 rounded w-20" />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="h-4 bg-slate-200 rounded w-16 ml-auto" />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="h-4 bg-slate-200 rounded w-16 ml-auto" />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="h-4 bg-slate-200 rounded w-12 mx-auto" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 bg-slate-200 rounded w-20" />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="h-4 bg-slate-200 rounded w-12 ml-auto" />
                      </td>
                    </tr>
                  ))}
                </>
              ) : (
                (filteredProducts || []).map((p) => (
                  <tr key={p.ID} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="bg-white p-1 border border-slate-100 rounded shadow-sm inline-block w-fit">
                          <BarcodeComponent
                            value={p.ID.toString()}
                            width={0.8}
                            height={20}
                            displayValue={false}
                            margin={0}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-slate-500 font-bold">{p.ID}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-800">{p.Name}</p>
                      <p className="text-[10px] text-slate-400 font-medium">{p.Unit}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md uppercase">
                        {p.Category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-slate-500 font-medium">Nu. {p.Cost.toFixed(2)}</td>
                    <td className="px-6 py-4 text-right font-bold text-brand">Nu. {p.Selling.toFixed(2)}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={cn(
                        "font-black text-lg",
                        p.Stock <= p.MinStock ? "text-brand" : "text-slate-800"
                      )}>
                        {p.Stock}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {p.Stock <= p.MinStock ? (
                        <div className="flex items-center gap-1.5 text-brand font-bold text-[10px] uppercase">
                          <AlertTriangle size={14} />
                          Low Stock
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-brand font-bold text-[10px] uppercase">
                          <CheckCircle2 size={14} />
                          Healthy
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => printBarcode(p.ID.toString())}
                        className="p-2 text-slate-400 hover:text-brand rounded-lg transition-all"
                        title="Print Barcode"
                      >
                        <Barcode size={18} />
                      </button>
                      <button
                        onClick={() => { setEditProduct(p); setEditAction('update'); setShowEditModal(true); }}
                        className="p-2 ml-2 text-slate-400 hover:text-brand rounded-lg transition-all"
                        title="Edit / Restock"
                      >
                        <Edit size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile list view: stacked cards for small screens */}
        <div className="block sm:hidden p-3 space-y-3">
          {(filteredProducts || []).length === 0 ? (
            <div className="p-4 bg-slate-50 rounded-lg text-slate-500 text-sm">No products found</div>
          ) : (
            (filteredProducts || []).map(p => (
              <div key={`mobile-${p.ID}`} className="bg-white border border-slate-100 rounded-lg p-3 shadow-sm flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <div className="bg-white p-1 border border-slate-100 rounded shadow-sm inline-block w-20">
                        <BarcodeComponent value={p.ID.toString()} width={0.6} height={18} displayValue={false} margin={0} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">{p.Name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{p.Unit} • <span className="font-mono">{p.ID}</span></p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[11px] font-bold rounded-md uppercase">{p.Category}</span>
                        <span className={cn("text-sm font-black", p.Stock <= p.MinStock ? 'text-brand' : 'text-slate-800')}>{p.Stock}</span>
                        <span className="text-[11px] text-slate-400">/ {p.MinStock}</span>
                      </div>
                      <div className="mt-2 text-[13px] text-slate-600">Cost: <span className="font-bold">Nu. {p.Cost.toFixed(2)}</span> • Sell: <span className="font-bold text-brand">Nu. {p.Selling.toFixed(2)}</span></div>
                    </div>
                  </div>
                </div>
                <div className="ml-3 flex-shrink-0 flex flex-col items-end gap-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => printBarcode(p.ID.toString())} className="p-2 text-slate-400 hover:text-brand rounded-lg transition-all" title="Print Barcode"><Barcode size={16} /></button>
                    <button onClick={() => { setEditProduct(p); setEditAction('update'); setShowEditModal(true); }} className="p-2 text-slate-400 hover:text-brand rounded-lg transition-all" title="Edit / Restock"><Edit size={16} /></button>
                  </div>
                  <div className="text-[11px] text-slate-400">{p.Stock <= p.MinStock ? 'Low stock' : 'Healthy'}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ADD CATEGORY MODAL */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">Add New Category</h3>
              <button onClick={() => setShowAddCategoryModal(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleAddCategoryOnly} className="p-8 space-y-6">
              <div className="space-y-1.5">
                <label htmlFor="categoryName" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Category Name</label>
                <input id="categoryName" name="categoryName" required type="text" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddCategoryModal(false)}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold transition-all",
                    "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                  )}
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  title={loading ? 'Saving...' : undefined}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold shadow-lg shadow-brand-light flex items-center justify-center gap-2 transition-all",
                    loading ? 'bg-brand text-white opacity-60 cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-hover'
                  )}
                >
                  {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                  <span className="ml-2">SAVE</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD PRODUCT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-slate-800">Add New Product</h3>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleAddProduct} className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
              <div className="bg-brand-light border border-brand-border p-3 rounded-xl flex items-center gap-3">
                <Barcode size={20} className="text-brand" />
                <p className="text-xs font-bold text-brand uppercase tracking-wider">
                  Barcode will be automatically generated upon saving.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="pName" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Product Name</label>
                  <input id="pName" name="pName" required type="text" placeholder="Enter product name" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pCat" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Category</label>
                  <select
                    id="pCat"
                    name="pCat"
                    required
                    value={selectedCat}
                    onChange={(e) => {
                      if (e.target.value === 'New') {
                        setShowAddCategoryModal(true);
                      } else {
                        setSelectedCat(e.target.value);
                      }
                    }}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium"
                  >
                    <option value="">Select Category</option>
                    {(categories || []).map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="New">+ Add New Category</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pUnit" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Unit</label>
                  <input id="pUnit" name="pUnit" required type="text" placeholder="e.g. Pcs, Kg, Ltr" defaultValue="Pcs" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pVendor" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Vendor</label>
                  <input id="pVendor" name="pVendor" type="text" placeholder="Vendor name (optional)" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Record as Purchase?</label>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2"><input id="pAsPurchase" name="pAsPurchase" type="checkbox" /> <span className="text-sm">Yes, record initial stock as a purchase</span></label>
                  </div>
                </div>

                <div id="pBillWrapper" className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="pBill" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Bill Number (optional)</label>
                  <input id="pBill" name="pBill" type="text" placeholder="e.g. P-INV-001" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>


                <div className="space-y-1.5">
                  <label htmlFor="pCost" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Cost Price</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                    <input id="pCost" name="pCost" required type="number" step="0.01" className="w-full pl-8 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pSell" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Selling Price</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                    <input id="pSell" name="pSell" required type="number" step="0.01" className="w-full pl-8 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pStock" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Initial Stock</label>
                  <input id="pStock" name="pStock" required type="number" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pMin" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Min Stock Alert</label>
                  <input id="pMin" name="pMin" required type="number" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
              </div>

              <div className="pt-6 flex gap-3 sticky bottom-0 bg-white">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 bg-white border border-slate-200 text-slate-500 rounded-xl font-bold hover:bg-slate-50 transition-all"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  title={loading ? 'Saving product...' : undefined}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold shadow-lg shadow-brand-light flex items-center justify-center gap-2 transition-all",
                    loading ? 'bg-brand text-white opacity-60 cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-hover'
                  )}
                >
                  {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                  <span className="ml-2">SAVE PRODUCT</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT / RESTOCK PRODUCT MODAL */}
      {showEditModal && editProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-slate-800">Edit / Restock Product</h3>
              <button onClick={() => { setShowEditModal(false); setEditProduct(null); }} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setEditLoading(true);
              try {
                const formData = new FormData(e.currentTarget);
                const vendor = (formData.get('eVendor') as string) || editProduct.Vendor || 'General';
                const cost = parseFloat(formData.get('eCost') as string) || editProduct.Cost;
                const selling = parseFloat(formData.get('eSell') as string) || editProduct.Selling;
                const minStock = parseFloat(formData.get('eMin') as string) || editProduct.MinStock;
                const setStockVal = formData.get('eStock') as string;
                const restockVal = formData.get('eRestock') as string;
                let newStock = editProduct.Stock;
                const restockAmount = restockVal ? parseFloat(restockVal || '0') : 0;
                if (editAction === 'update') {
                  if (restockVal) {
                    const add = parseFloat(restockVal || '0');
                    newStock = newStock + (isNaN(add) ? 0 : add);
                  } else if (setStockVal) {
                    newStock = parseFloat(setStockVal || String(editProduct.Stock));
                  }
                }

                const product = {
                  ID: editProduct.ID,
                  Name: (formData.get('eName') as string) || editProduct.Name,
                  Category: (formData.get('eCat') as string) || editProduct.Category,
                  Unit: (formData.get('eUnit') as string) || editProduct.Unit,
                  Cost: cost,
                  Selling: selling,
                  Stock: newStock,
                  MinStock: minStock,
                  Vendor: vendor
                };

                // If user chose to restock via purchase, call postPurchase after saving product metadata
                if (editAction === 'restock' && restockAmount > 0) {
                  // Save product metadata but do not override Stock (let postPurchase update stock)
                  const saveProd = { ...product, Stock: editProduct.Stock };
                  const resSave = await fetch(WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'saveProduct', product: saveProd }) });
                  const saved = await resSave.json();
                  if (!saved.success) {
                    console.error('Failed to save product metadata before purchase', saved);
                  }

                  const billNo = (formData.get('eBill') as string) || `PUR-${Date.now()}`;
                  const supplier = vendor || 'General';
                  const items = [{ itemId: editProduct.ID, itemName: product.Name, qty: restockAmount, cost }];
                  const res = await fetch(WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'postPurchase', billNo, supplier, items, user: currentUser }) });
                  const data = await res.json();
                  if (data && data.success) {
                    setShowEditModal(false);
                    setEditProduct(null);
                    try { await onRefresh(); } catch (e) { console.error('onRefresh failed', e); }
                  } else {
                    console.error('Failed to post purchase', data);
                  }
                } else {
                  // Normal update: save product including new stock value
                  const res = await fetch(WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'saveProduct', product }) });
                  const data = await res.json();
                  if (data.success) {
                    setShowEditModal(false);
                    setEditProduct(null);
                    try { await onRefresh(); } catch (e) { console.error('onRefresh failed', e); }
                  } else {
                    console.error('Failed to save product', data);
                  }
                }
              } catch (err) {
                console.error(err);
              } finally {
                setEditLoading(false);
              }
            }} className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-600">Action</label>
                <div className="flex items-center gap-4">
                  <label className={cn('inline-flex items-center gap-2 cursor-pointer')}>
                    <input type="radio" name="editAction" checked={editAction === 'update'} onChange={() => setEditAction('update')} />
                    <span className="text-sm">Update Product</span>
                  </label>
                  <label className={cn('inline-flex items-center gap-2 cursor-pointer')}>
                    <input type="radio" name="editAction" checked={editAction === 'restock'} onChange={() => setEditAction('restock')} />
                    <span className="text-sm">Restock (Purchase)</span>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="eName" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Product Name</label>
                  <input id="eName" name="eName" defaultValue={editProduct.Name} type="text" placeholder="Enter product name" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="eCat" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Category</label>
                  <input id="eCat" name="eCat" defaultValue={editProduct.Category} type="text" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="eUnit" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Unit</label>
                  <input id="eUnit" name="eUnit" defaultValue={editProduct.Unit} type="text" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="eVendor" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Vendor</label>
                  <input id="eVendor" name="eVendor" defaultValue={editProduct.Vendor} type="text" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="eCost" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Cost Price</label>
                  <input id="eCost" name="eCost" defaultValue={String(editProduct.Cost)} type="number" step="0.01" className="w-full pl-4 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="eSell" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Selling Price</label>
                  <input id="eSell" name="eSell" defaultValue={String(editProduct.Selling)} type="number" step="0.01" className="w-full pl-4 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="eStock" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Set Stock (absolute)</label>
                  <input id="eStock" name="eStock" defaultValue={String(editProduct.Stock)} type="number" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="eRestock" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Restock Amount (add)</label>
                  <input id="eRestock" name="eRestock" placeholder="e.g. 10 to add 10 units" type="number" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
                {editAction === 'restock' && (
                  <div className="space-y-1.5">
                    <label htmlFor="eBill" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Bill Number (purchase)</label>
                    <input id="eBill" name="eBill" placeholder="e.g. P-INV-001" type="text" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label htmlFor="eMin" className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Min Stock Alert</label>
                  <input id="eMin" name="eMin" defaultValue={String(editProduct.MinStock)} type="number" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                </div>
              </div>
              <div className="pt-6 flex gap-3 sticky bottom-0 bg-white">
                <button type="button" onClick={() => { setShowEditModal(false); setEditProduct(null); }} className="flex-1 py-3 bg-white border border-slate-200 text-slate-500 rounded-xl font-bold hover:bg-slate-50 transition-all">CANCEL</button>
                <button
                  type="submit"
                  disabled={editLoading}
                  title={editLoading ? 'Saving...' : undefined}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold shadow-lg shadow-brand-light flex items-center justify-center gap-2 transition-all",
                    editLoading ? 'bg-brand text-white opacity-60 cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-hover'
                  )}
                >
                  {editLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                  <span className="ml-2">SAVE</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BARCODE PRINT LAYOUT: renders two labels per physical page (10.5cm x 7cm) */}
      <div className="fixed -left-[9999px] top-0 pointer-events-none bg-white">
        {/* Print-specific page size for label sheets: 3.3in width, 1.2in height */}
        <style>{`@page { size: 3.3in 1.2in; margin: 0; } @media print { body { margin: 0; } .label-sheet { page-break-after: always; } }`}</style>

        {/* barcodeRef is used by react-to-print to capture the HTML to print */}
        <div ref={barcodeRef} className="label-print-area">
          {/* If labelsToPrint is present, render pages from it; else fallback to single-product print (existing behavior) */}
          {labelsToPrint && labelsToPrint.length > 0 ? (
            // Render pages: chunk labelsToPrint into pairs
            labelsToPrint.reduce<React.ReactElement[]>((acc, cur, idx) => {
              if (idx % 2 === 0) {
                const left = labelsToPrint[idx];
                const right = labelsToPrint[idx + 1] || {};
                acc.push(
                  <div className="label-sheet" key={`sheet-${idx}`} style={{ width: '3.3in', height: '1.2in', display: 'flex', gap: '0.1in', padding: '0.05in 0.1in', boxSizing: 'border-box', alignItems: 'center', justifyContent: 'space-between' }}>
                    {renderSheetLabel(left)}
                    {renderSheetLabel(right)}
                  </div>
                );
              }
              return acc;
            }, [])
          ) : (
            // Existing single barcode print (compatibility)
            barcodeToPrint && (() => {
              const prod = printProduct ?? products.find(p => p.ID.toString() === barcodeToPrint);
              if (!prod) return null;
              const Label = () => (
                <div style={{ flex: labelsPerSheet === 1 ? '0 0 auto' : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <BarcodeComponent value={String(barcodeToPrint)} width={1} height={60} displayValue={false} margin={0} />
                  <div style={{ marginTop: '0.15cm', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#0f172a' }}>{prod.Name}</div>
                    <div style={{ fontSize: '12px', fontWeight: 900, color: '#0f172a' }}>Nu. {Number(prod.Selling).toFixed(2)}</div>
                  </div>
                </div>
              );

              if (labelsPerSheet === 1) return <div style={{ width: '3.3in', height: '1.2in', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Label /></div>;
              return (
                <div style={{ width: '3.3in', height: '1.2in', display: 'flex', gap: '0.1in', padding: '0.05in 0.1in', boxSizing: 'border-box', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Label />
                  <div style={{ width: '0.1cm', background: 'transparent' }} />
                  <Label />
                </div>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
}
