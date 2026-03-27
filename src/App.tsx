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
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';
// Lazy-load barcode to reduce initial bundle size and speed up first paint
const BarcodeComponent = React.lazy(() => import('react-barcode'));
import * as XLSX from 'xlsx';
import { useReactToPrint } from 'react-to-print';

/**
 * UTILITIES
 */
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Placeholder for the Web App URL - the user will replace this or we use the provided one
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyJQ4PkVvuauaYKX-cqOzUOeYKA_d7Nlhy-FIqxkPAPhfleVQsIFId43SFXdPgjjgdl2g/exec';

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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pos' | 'financials' | 'inventory' | 'setup'>('dashboard');
  const [config, setConfig] = useState<Config | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [dashboardData, setDashboardData] = useState<{ lowStock: Product[], chartData: any[] }>({ lowStock: [], chartData: [] });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('Walk-in Customer');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [currentUser] = useState('Admin');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null); // BillNo if editing
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [lastBill, setLastBill] = useState<Bill | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);
  const [returnToTab, setReturnToTab] = useState<string | null>(null);

  const handlePrint = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: `Bill_${lastBill?.BillNo || 'Receipt'}`,
  });

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
          chartData: Array.isArray(data.chartData) ? data.chartData : []
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
        resetPOS();
        // Refresh products and dashboard so UI reflects edits immediately
        try {
          await fetchProducts();
        } catch (e) {
          console.error('Failed to refresh products after save', e);
        }
        try {
          await fetchDashboardData();
        } catch (e) {
          console.error('Failed to refresh dashboard after save', e);
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
    setIsEditing(null);
    if (returnToTab) {
      setActiveTab(returnToTab);
      setReturnToTab(null);
    }
  }, [returnToTab]);

  const handleBarcodeSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const barcode = searchQuery.trim();
    if (!barcode) return;

    const product = products.find(p => p.ID.toString() === barcode);
    if (product) {
      addToCart(product);
      setSearchQuery('');
    } else {
      setShowSuggestions(true);
    }
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
  }, [setCart, setCustomerName, setPaymentMethod, setIsEditing, setMessage, setLoading, returnToTab, setActiveTab]);

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
    setActiveTab('dashboard');
  };

  if (initialLoading && user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-brand/30 border-t-brand rounded-full animate-spin" />
        <p className="text-slate-500 font-bold animate-pulse">Initializing System...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} fetchConfig={fetchConfig} />;
  }

  const isAllowed = (tab: string) => {
    if (user.role === 'ADMIN') return true;
    return config?.staff_perms?.[tab] ?? false;
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

          {/* Small-screen nav (kept at top on mobile) */}
          <nav className="flex h-full md:hidden">
            {isAllowed('dashboard') && (
              <TabButton 
                active={activeTab === 'dashboard'} 
                onClick={() => setActiveTab('dashboard')} 
                icon={LayoutDashboard} 
                label="Dashboard" 
              />
            )}
            {isAllowed('pos') && (
              <TabButton 
                active={activeTab === 'pos'} 
                onClick={() => setActiveTab('pos')} 
                icon={ShoppingCart} 
                label="Point of Sale" 
              />
            )}
            {isAllowed('financials') && (
              <TabButton 
                active={activeTab === 'financials'} 
                onClick={() => setActiveTab('financials')} 
                icon={History} 
                label="Financials" 
              />
            )}
            {isAllowed('inventory') && (
              <TabButton 
                active={activeTab === 'inventory'} 
                onClick={() => setActiveTab('inventory')} 
                icon={Package} 
                label="Inventory" 
              />
            )}
            {user.role === 'ADMIN' && (
              <TabButton 
                active={activeTab === 'setup'} 
                onClick={() => setActiveTab('setup')} 
                icon={Settings} 
                label="Setup" 
              />
            )}
          </nav>

          <div className="flex items-center gap-4">
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

      <div className="flex">
        <aside className="hidden md:flex flex-col w-64 h-[calc(100vh-64px)] sticky top-16 bg-slate-900 text-white shadow-lg">
          <nav className="mt-4 flex-1 px-2 space-y-1">
            {isAllowed('dashboard') && (
              <button onClick={() => setActiveTab('dashboard')} className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-semibold',
                activeTab === 'dashboard' ? 'bg-red-700/80 text-white' : 'text-slate-300 hover:bg-slate-800/60'
              )}>
                <LayoutDashboard size={18} />
                <span>Dashboard</span>
              </button>
            )}
            {isAllowed('pos') && (
              <button onClick={() => setActiveTab('pos')} className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-semibold',
                activeTab === 'pos' ? 'bg-red-700/80 text-white' : 'text-slate-300 hover:bg-slate-800/60'
              )}>
                <ShoppingCart size={18} />
                <span>Point of Sale</span>
              </button>
            )}
            {isAllowed('financials') && (
              <button onClick={() => setActiveTab('financials')} className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-semibold',
                activeTab === 'financials' ? 'bg-red-700/80 text-white' : 'text-slate-300 hover:bg-slate-800/60'
              )}>
                <History size={18} />
                <span>Financials</span>
              </button>
            )}
            {isAllowed('inventory') && (
              <button onClick={() => setActiveTab('inventory')} className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-semibold',
                activeTab === 'inventory' ? 'bg-red-700/80 text-white' : 'text-slate-300 hover:bg-slate-800/60'
              )}>
                <Package size={18} />
                <span>Inventory</span>
              </button>
            )}
            {user.role === 'ADMIN' && (
              <button onClick={() => setActiveTab('setup')} className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-semibold',
                activeTab === 'setup' ? 'bg-red-700/80 text-white' : 'text-slate-300 hover:bg-slate-800/60'
              )}>
                <Settings size={18} />
                <span>Setup</span>
              </button>
            )}
          </nav>
          <div className="px-4 py-4 border-t border-slate-800 text-[12px] text-slate-400">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center text-red-300">{user.username?.charAt(0)}</div>
              <div>
                <div className="text-sm font-semibold text-white">{user.username}</div>
                <div className="text-[11px] text-slate-400">{user.role}</div>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1">
          <div className="max-w-7xl mx-auto p-4 md:p-6">
        {activeTab === 'dashboard' && isAllowed('dashboard') && (
          <DashboardTab 
            data={dashboardData} 
            onRefresh={fetchDashboardData} 
            onGoToInventory={() => setActiveTab('inventory')}
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
                    <span className="hidden sm:inline">Tap to Scan</span>
                  </button>
                </form>

                {/* SUGGESTIONS DROPDOWN */}
                {showSuggestions && filteredSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-2 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                      <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider px-2">Products Found</span>
                      <span className="text-[10px] text-slate-400 px-2">{filteredSuggestions.length} results</span>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto">
                      {(filteredSuggestions || []).map((p) => (
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
                      ))}
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
          <FinancialsTab onEdit={editExistingBill} onNotify={setMessage} />
        )}

        {activeTab === 'inventory' && isAllowed('inventory') && (
          <InventoryTab onRefresh={async () => { await fetchProducts(); await fetchDashboardData(); }} products={products} />
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
                </div>

                <div className="mt-8 space-y-3">
                <button 
                  onClick={() => handlePrint()}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
                >
                  <Printer size={20} />
                  PRINT RECEIPT
                </button>
                <button 
                  onClick={() => setShowReceipt(false)}
                  className="w-full py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all"
                >
                  DONE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRINT-ONLY RECEIPT LAYOUT */}
      <div className="fixed -left-[9999px] top-0 pointer-events-none bg-white">
        <div ref={receiptRef} className="p-8 font-mono text-sm w-[80mm] bg-white text-black">
          <div className="text-center space-y-1 mb-6">
            <h2 className="text-xl font-bold">Samten Tshongkhang</h2>
            <p className="text-xs">Sunday Market, Thimphu</p>
            <p className="text-xs">Phone: +975 17655336 / +975 17909608</p>
          </div>
          
          <div className="border-y border-dashed py-2 mb-4 space-y-1">
            <div className="flex justify-between">
              <span>Bill No:</span>
              <span className="font-bold">{lastBill?.BillNo}</span>
            </div>
            <div className="flex justify-between">
              <span>Date:</span>
              <span>{lastBill && format(new Date(lastBill.DateTime), 'dd/MM/yyyy HH:mm')}</span>
            </div>
            <div className="flex justify-between">
              <span>Customer:</span>
              <span>{lastBill?.CustomerName}</span>
            </div>
            <div className="flex justify-between">
              <span>User:</span>
              <span>{lastBill?.User}</span>
            </div>
          </div>

          <table className="w-full mb-4">
            <thead>
              <tr className="border-b border-dashed text-left">
                <th className="pb-1">Item</th>
                <th className="pb-1 text-center">Qty</th>
                <th className="pb-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lastBill?.lines?.map((line, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1">
                    {line.ItemName}
                    {line.LineType === 'RETURN' && <span className="ml-1 text-[10px] font-bold">(RET)</span>}
                    <div className="text-[10px]">Nu. {line.Rate.toFixed(2)} + GST</div>
                  </td>
                  <td className="py-1 text-center">{line.Qty}</td>
                  <td className="py-1 text-right">
                    {line.LineType === 'RETURN' && '-'}Nu. {line.LineTotal.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-dashed pt-2 space-y-1">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>Nu. {lastBill?.Subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>GST Total:</span>
              <span>Nu. {lastBill?.GSTTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t border-dashed">
              <span>GRAND TOTAL:</span>
              <span>Nu. {lastBill?.GrandTotal.toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-6 text-center border-t border-dashed pt-4">
            <p className="font-bold uppercase tracking-widest">Paid via {lastBill?.Method}</p>
            <p className="text-[10px] mt-4">Thank you for shopping with us!</p>
            <p className="text-[8px] mt-1">Powered by Samten Inventory System</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * LOGIN SCREEN
 */
function LoginScreen({ onLogin, fetchConfig }: { onLogin: (user: UserProfile) => void, fetchConfig: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Simulate network delay for a better feel
    await new Promise(resolve => setTimeout(resolve, 800));

    if (username === 'admin' && password === 'Admin@123$') {
      const u: UserProfile = { username: 'Admin', role: 'ADMIN' };
      onLogin(u);
      fetchConfig();
    } else if (username === 'staff' && password === 'Staff@123$') {
      const u: UserProfile = { username: 'Staff', role: 'STAFF' };
      onLogin(u);
      fetchConfig();
    } else {
      setError('Invalid username or password');
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
            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Username</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                <User size={18} />
              </div>
              <input 
                required
                type="text" 
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all font-medium"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                <ShieldCheck size={18} />
              </div>
              <input 
                required
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
            <button onClick={() => { if (config) { setGstPercent((config.gst_rate||0)*100); setBillPrefix(config.bill_prefix||''); } }} className="py-3 px-4 bg-white border border-slate-200 rounded-xl font-bold">RESET</button>
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
function DashboardTab({ data, onRefresh, onGoToInventory }: { data: any, onRefresh: () => void, onGoToInventory: () => void }) {
  const COLORS = ['#f24153', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Delay rendering chart to ensure container dimensions are settled
    const timer = setTimeout(() => setIsReady(true), 300);
    return () => clearTimeout(timer);
  }, []);

  // Defensive checks
  const chartData = Array.isArray(data?.chartData) ? data.chartData : [];
  const lowStock = Array.isArray(data?.lowStock) ? data.lowStock : [];

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SALES BY CATEGORY CHART */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp size={18} className="text-brand" />
              Sales by Category
            </h3>
            <span className="text-[10px] font-bold uppercase text-slate-400 bg-slate-50 px-2 py-1 rounded">All Time</span>
          </div>
          <div className={`${chartData.length <= 1 ? 'h-[200px]' : 'h-[300px]'} w-full transition-all duration-500 overflow-hidden min-h-0 min-w-0`}>
            {isReady && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} debounce={50}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis 
                    scale="sqrt"
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    tickFormatter={(value) => `Nu. ${value}`}
                  />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={60}>
                    {chartData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : chartData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <TrendingUp size={48} className="opacity-10 mb-2" />
                <p className="text-sm font-medium">No sales data available yet</p>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-slate-100 border-t-brand rounded-full animate-spin" />
              </div>
            )}
          </div>
        </div>

        {/* LOW STOCK ALERTS */}
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
      </div>
    </div>
  );
}

/**
 * FINANCIALS TAB
 */
function FinancialsTab({ onEdit, onNotify }: { onEdit: (billNo: string) => void, onNotify: (m: { type: 'success' | 'error', text: string } | null) => void }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [startDate, setStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [billSearch, setBillSearch] = useState('');
  const searchDebounce = useRef<number | null>(null);

  useEffect(() => {
    // On mount, load only today's transactions (no fallback to recent bills).
    // If there are no transactions today, UI will display the 'No transactions found' message.
    (async () => {
      await fetchBills({ startDate, endDate });
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

  const fetchBills = async (opts?: { startDate?: string; endDate?: string; billNo?: string }) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { action: 'listBills', limit: '200' };
      if (opts?.billNo) {
        params.billNo = opts.billNo;
      } else {
        // if no billNo search provided, use date range if available
        if (opts?.startDate) params.start = opts.startDate;
        if (opts?.endDate) params.end = opts.endDate;
      }
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`${WEB_APP_URL}?${qs}`);
      if (!res.ok) throw new Error('Failed to fetch bills');
      const data = await res.json();
      let list = Array.isArray(data) ? data : [];
      // Normalize each bill: ensure DateTime is an ISO string and GrandTotal is a number
      list = list.map((b: any) => ({
        ...b,
        DateTime: b.DateTime ? (typeof b.DateTime === 'string' ? b.DateTime : new Date(b.DateTime).toISOString()) : null,
        GrandTotal: (b.GrandTotal !== undefined && b.GrandTotal !== null) ? Number(b.GrandTotal) : 0,
        Subtotal: (b.Subtotal !== undefined && b.Subtotal !== null) ? Number(b.Subtotal) : 0,
        GSTTotal: (b.GSTTotal !== undefined && b.GSTTotal !== null) ? Number(b.GSTTotal) : 0,
      }));
      setBills(list);
      return list;
    } catch (err) {
      console.error(err);
      setBills([]);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
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
      searchDebounce.current = window.setTimeout(() => fetchBills({ startDate, endDate }), 250);
      return;
    }
    searchDebounce.current = window.setTimeout(() => {
      fetchBills({ billNo: billSearch });
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
          <button onClick={() => fetchBills({ startDate, endDate })} className="p-2 hover:bg-white rounded-xl border border-slate-200 text-slate-500 transition-all">
            <History size={20} />
          </button>
        </div>
      </div>

      {/* Filters: date range and bill number search */}
      <div className="mt-4 mb-2 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 mr-2">Start</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <label className="text-xs text-slate-500 ml-3 mr-2">End</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={() => fetchBills({ startDate, endDate })} className="ml-3 px-3 py-2 bg-brand text-white rounded-lg text-sm font-bold">Fetch</button>
        </div>

        <div className="flex items-center gap-2">
          <input
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
                {loading ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400">Loading history...</td></tr>
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
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400">No transactions found for the selected range.</td></tr>
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
 * INVENTORY TAB
 */
function InventoryTab({ products, onRefresh }: { products: Product[], onRefresh: () => void }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [barcodeToPrint, setBarcodeToPrint] = useState<string | null>(null);
  const barcodeRef = useRef<HTMLDivElement>(null);
  const [printProduct, setPrintProduct] = useState<Product | null>(null);
  const [labelsPerSheet, setLabelsPerSheet] = useState<number>(2); // 1 or 2 labels per physical sheet

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

  const exportToExcel = () => {
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
    
    const formData = new FormData(e.currentTarget);
    const category = isAddingNewCategory ? formData.get('newCat') as string : formData.get('pCat') as string;
    
    const product = {
      ID: '', // ID is generated by backend
      Name: formData.get('pName') as string,
      Category: category,
  Unit: (formData.get('pUnit') as string) || 'Pcs',
      Cost: parseFloat(formData.get('pCost') as string),
      Selling: parseFloat(formData.get('pSell') as string),
      Stock: parseFloat(formData.get('pStock') as string),
      MinStock: parseFloat(formData.get('pMin') as string),
      Vendor: (formData.get('pVendor') as string) || 'General'
    };

    try {
      const res = await fetch(WEB_APP_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveProduct', product })
      });
      const data = await res.json();
      if (data.success) {
        setShowAddModal(false);
        setIsAddingNewCategory(false);
        onRefresh();
        fetchCategories();
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
        body: JSON.stringify({ action: 'addCategory', categoryName })
      });
      const data = await res.json();
      if (data.success) {
        setShowAddCategoryModal(false);
        fetchCategories();
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
        <div className="flex items-center gap-3">
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
            onClick={() => setShowAddCategoryModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all active:scale-[0.98]"
          >
            <Plus size={18} />
            ADD CATEGORY
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
        <div className="overflow-x-auto">
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
              {(filteredProducts || []).map((p) => (
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
                      onClick={() => { setEditProduct(p); setShowEditModal(true); }}
                      className="p-2 ml-2 text-slate-400 hover:text-brand rounded-lg transition-all"
                      title="Edit / Restock"
                    >
                      <Edit size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD CATEGORY MODAL */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
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
                    onChange={(e) => setIsAddingNewCategory(e.target.value === 'New')}
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

                {isAddingNewCategory && (
                  <div className="space-y-1.5 sm:col-span-2 animate-in slide-in-from-top-2 duration-200">
                    <label htmlFor="newCat" className="text-[10px] font-bold uppercase text-brand tracking-wider">New Category Name</label>
                    <input id="newCat" name="newCat" required type="text" placeholder="Enter category name..." className="w-full px-4 py-2.5 bg-brand-light border border-brand-border rounded-xl focus:ring-4 focus:ring-brand/10 focus:border-brand outline-none transition-all text-sm font-medium" />
                  </div>
                )}
                
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
                if (restockVal) {
                  const add = parseFloat(restockVal || '0');
                  newStock = newStock + (isNaN(add) ? 0 : add);
                } else if (setStockVal) {
                  newStock = parseFloat(setStockVal || String(editProduct.Stock));
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

                const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'saveProduct', product }) });
                const data = await res.json();
                if (data.success) {
                  setShowEditModal(false);
                  setEditProduct(null);
                  onRefresh();
                } else {
                  console.error('Failed to save product', data);
                }
              } catch (err) {
                console.error(err);
              } finally {
                setEditLoading(false);
              }
            }} className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
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
        {/* Inject print-specific page size to help printers honor label dimensions */}
        <style>{`@page { size: 10.5cm 7cm; margin: 0; }
          @media print { body { margin: 0; } .barcode-print-sheet { page-break-after: always; } }
        `}</style>

        <div
          ref={barcodeRef}
          className="barcode-print-sheet"
          style={{
            width: '10.5cm',
            height: '7cm',
            padding: '0.3cm',
            boxSizing: 'border-box',
            display: 'flex',
            gap: '0.4cm',
            alignItems: 'center',
            justifyContent: labelsPerSheet === 1 ? 'center' : 'space-between',
            background: 'white',
            color: 'black'
          }}
        >
          {barcodeToPrint && (() => {
            const prod = printProduct ?? products.find(p => p.ID.toString() === barcodeToPrint);
            if (!prod) return null;

            const Label = () => (
              <div style={{ flex: labelsPerSheet === 1 ? '0 0 auto' : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <BarcodeComponent
                  value={String(barcodeToPrint)}
                  width={1}
                  height={60}
                  displayValue={false}
                  margin={0}
                />
                <div style={{ marginTop: '0.15cm', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#0f172a' }}>{prod.Name}</div>
                  <div style={{ fontSize: '12px', fontWeight: 900, color: '#0f172a' }}>Nu. {Number(prod.Selling).toFixed(2)}</div>
                </div>
              </div>
            );

            if (labelsPerSheet === 1) {
              return <Label />;
            }

            // default: two labels per sheet
            return (
              <>
                <Label />
                <div style={{ width: '0.1cm', background: 'transparent' }} />
                <Label />
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
