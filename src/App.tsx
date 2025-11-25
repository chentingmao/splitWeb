import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Users, DollarSign, List, Calculator, ArrowRight, X, Cloud, CloudOff, AlertCircle } from 'lucide-react';
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, type Auth, type User as FirebaseUser } from "firebase/auth";
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, type Firestore } from "firebase/firestore";

// ------------------------------------------------------------------
// TypeScript Interfaces (型別定義)
// ------------------------------------------------------------------
interface User {
  id: string;
  name: string;
  createdAt?: number;
}

interface Expense {
  id: string;
  payerId: string;
  amount: number;
  description: string;
  involvedIds: string[];
  createdAt?: number;
  dateStr?: string;
}

interface Transaction {
  from: string;
  to: string;
  amount: number;
}

interface SettlementReport {
  transactions: Transaction[];
  balances: Record<string, number>;
}

// ------------------------------------------------------------------
// Firebase 設定區
// ------------------------------------------------------------------
// 修正：變數名稱統一為 DEFAULT_FIREBASE_CONFIG 以符合後續使用
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDeZE2j3w4BwuYtUn1fIh2U5ed0tiAAM1s",
  authDomain: "travelslip-6f024.firebaseapp.com",
  projectId: "travelslip-6f024",
  storageBucket: "travelslip-6f024.firebasestorage.app",
  messagingSenderId: "351890443164",
  appId: "1:351890443164:web:e17a8e125611279e815659",
  measurementId: "G-H5RN7E1HCB"
};

// ------------------------------------------------------------------
// Firebase 初始化邏輯
// ------------------------------------------------------------------
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let appId = 'my-travel-app';

try {
  // 使用 (window as any) 避開 TypeScript 對全域變數的檢查
  const win = typeof window !== 'undefined' ? (window as any) : {};
  const envConfig = win.__firebase_config;
  const envAppId = win.__app_id;
  const envToken = win.__initial_auth_token;

  const config = envConfig 
    ? JSON.parse(envConfig) 
    : DEFAULT_FIREBASE_CONFIG;
  
  if (envAppId) {
    appId = envAppId;
  }

  // 避免重複初始化
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);

  // 將 token 存入全域變數供後續使用
  if (typeof window !== 'undefined') {
    win._temp_token = envToken;
  }
} catch (e) {
  console.error("Firebase 初始化失敗:", e);
}

export default function App() {
  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const [user, setUser] = useState<FirebaseUser | null>(null); 
  const [dbError, setDbError] = useState<string | null>(null);
  
  const [activeTab, setActiveTab] = useState<'expenses' | 'users' | 'report'>('expenses');
  
  // 定義明確的 State 型別，解決 never[] 問題
  const [users, setUsers] = useState<User[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  
  // Form States
  const [newUserName, setNewUserName] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [payerId, setPayerId] = useState('');
  const [involvedIds, setInvolvedIds] = useState<string[]>([]);

  // ------------------------------------------------------------
  // Effect: 1. 處理登入 (Auth)
  // ------------------------------------------------------------
  useEffect(() => {
    if (!auth) {
      setDbError("Firebase 設定未完成，請檢查程式碼上方的 Config。");
      return;
    }

    const initAuth = async () => {
      try {
        const token = (window as any)._temp_token;
        if (token) {
          await signInWithCustomToken(auth!, token);
        } else {
          await signInAnonymously(auth!);
        }
      } catch (err) {
        console.error("登入失敗", err);
        setDbError("登入雲端服務失敗，請重新整理試試。");
      }
    };
    
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setDbError(null);
    });
    return () => unsubscribe();
  }, []);

  // ------------------------------------------------------------
  // Effect: 2. 監聽資料 (Firestore)
  // ------------------------------------------------------------
  useEffect(() => {
    if (!user || !db) return;

    // 定義資料路徑 (遵循 Artifacts 規則: public/data)
    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'travel_users');
    const expensesRef = collection(db, 'artifacts', appId, 'public', 'data', 'travel_expenses');

    // 監聽使用者列表
    const unsubUsers = onSnapshot(usersRef, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
      // 簡單排序
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setUsers(list);
      
      // 如果還沒有選付款人，預設選第一個人
      if (list.length > 0) {
        setPayerId(prev => prev || list[0].id);
      }
    }, (err) => {
      console.error("讀取使用者失敗", err);
      setDbError("無法讀取資料，請檢查網路連線。");
    });

    // 監聽消費列表
    const unsubExpenses = onSnapshot(expensesRef, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
      // 依時間排序
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setExpenses(list);
    }, (err) => {
      console.error("讀取帳目失敗", err);
    });

    return () => {
      unsubUsers();
      unsubExpenses();
    };
  }, [user]);

  // 當使用者列表變更時，自動將「分給誰」預設為全選
  useEffect(() => {
    if (users.length > 0 && involvedIds.length === 0) {
      setInvolvedIds(users.map(u => u.id));
    }
  }, [users.length]);

  // ------------------------------------------------------------
  // Actions: 資料寫入
  // ------------------------------------------------------------
  const addUser = async () => {
    if (!newUserName.trim() || !user || !db) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'travel_users'), {
        name: newUserName.trim(),
        createdAt: Date.now()
      });
      setNewUserName('');
    } catch (err) {
      console.error("新增成員失敗", err);
      alert("新增成員失敗");
    }
  };

  const removeUser = async (idToRemove: string) => {
    if (!db) return;
    // 檢查是否有相關帳目
    const hasExpense = expenses.some(e => e.payerId === idToRemove || e.involvedIds.includes(idToRemove));
    if (hasExpense) {
      alert("這位朋友已經有帳目紀錄，無法刪除。請先刪除相關帳目。");
      return;
    }
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'travel_users', idToRemove));
    } catch (err) {
      console.error("刪除失敗", err);
    }
  };

  const addExpense = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (!description.trim()) return;
    if (involvedIds.length === 0) return;
    if (!payerId || !db) return;

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'travel_expenses'), {
        payerId,
        amount: parseFloat(amount),
        description: description.trim(),
        involvedIds,
        createdAt: Date.now(),
        dateStr: new Date().toLocaleString()
      });
      
      setAmount('');
      setDescription('');
    } catch (err) {
      console.error("新增帳目失敗", err);
      alert("新增帳目失敗");
    }
  };

  const removeExpense = async (id: string) => {
    if (!db) return;
    if (!window.confirm("確定要刪除這筆帳目嗎？")) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'travel_expenses', id));
    } catch (err) {
      console.error("刪除失敗", err);
    }
  };

  // ------------------------------------------------------------
  // Local Helper Logic
  // ------------------------------------------------------------
  const toggleInvolved = (userId: string) => {
    if (involvedIds.includes(userId)) {
      setInvolvedIds(involvedIds.filter(id => id !== userId));
    } else {
      setInvolvedIds([...involvedIds, userId]);
    }
  };

  const selectAllInvolved = () => {
    setInvolvedIds(users.map(u => u.id));
  };

  // ------------------------------------------------------------
  // Logic: 結算演算法
  // ------------------------------------------------------------
  const settlementReport = useMemo<SettlementReport>(() => {
    let balances: Record<string, number> = {};
    users.forEach(u => balances[u.id] = 0);

    expenses.forEach(exp => {
      const paidBy = exp.payerId;
      const amt = exp.amount;
      const splitAmong = exp.involvedIds || [];
      
      // 確保 paidBy 存在於 balances 中 (避免 deleted user 導致 crash)
      if (balances[paidBy] !== undefined) {
        balances[paidBy] += amt;
      }

      if (splitAmong.length > 0) {
        const splitAmount = amt / splitAmong.length;
        splitAmong.forEach(uid => {
          if (balances[uid] !== undefined) {
            balances[uid] -= splitAmount;
          }
        });
      }
    });

    let debtors: { id: string; name: string; amount: number }[] = [];
    let creditors: { id: string; name: string; amount: number }[] = [];

    users.forEach(u => {
      const bal = balances[u.id];
      const roundedBal = Math.round(bal * 100) / 100;
      if (roundedBal < -0.01) debtors.push({ id: u.id, name: u.name, amount: -roundedBal });
      if (roundedBal > 0.01) creditors.push({ id: u.id, name: u.name, amount: roundedBal });
    });

    let transactions: Transaction[] = [];
    // 型別安全的排序
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    let i = 0;
    let j = 0;

    while (i < debtors.length && j < creditors.length) {
      let debtor = debtors[i];
      let creditor = creditors[j];
      let amt = Math.min(debtor.amount, creditor.amount);
      
      transactions.push({
        from: debtor.name,
        to: creditor.name,
        amount: amt
      });

      debtor.amount -= amt;
      creditor.amount -= amt;

      if (debtor.amount < 0.01) i++;
      if (creditor.amount < 0.01) j++;
    }

    return { transactions, balances };
  }, [users, expenses]);

  const getUserName = (id: string) => users.find(u => u.id === id)?.name || '未知';

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans pb-20">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4 shadow-lg sticky top-0 z-10 flex justify-between items-center">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Calculator size={24} />
          旅費分帳小幫手
          <span className="text-xs font-normal bg-blue-700 px-2 py-1 rounded ml-2">雲端同步版</span>
        </h1>
        <div className="text-xs flex items-center gap-1">
          {user ? <Cloud size={16} className="text-green-300"/> : <CloudOff size={16} className="text-red-300"/>}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-md mx-auto p-4">

        {/* Error / Status Message */}
        {dbError && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm flex items-start gap-2 border border-red-200">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div>{dbError}</div>
          </div>
        )}

        {/* Hint for first time users */}
        {users.length === 0 && !dbError && (
          <div className="bg-blue-50 text-blue-700 p-4 rounded-xl mb-4 border border-blue-200">
            <h3 className="font-bold flex items-center gap-2"><Users size={18}/> 歡迎使用！</h3>
            <p className="text-sm mt-1">目前還沒有任何成員。請先切換到「成員」分頁，輸入你與朋友的名字。</p>
          </div>
        )}

        {/* --- VIEW: ADD EXPENSE (DEFAULT) --- */}
        {activeTab === 'expenses' && (
          <div className="space-y-6">
            
            {/* Quick Stats */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
              <div>
                <p className="text-sm text-gray-500">總支出</p>
                <p className="text-2xl font-bold text-blue-600">
                  ${expenses.reduce((acc, cur) => acc + cur.amount, 0).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">筆數</p>
                <p className="text-xl font-semibold">{expenses.length}</p>
              </div>
            </div>

            {/* Add Form */}
            <div className="bg-white p-5 rounded-xl shadow-md border border-gray-100 relative">
              {users.length === 0 && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] z-10 flex items-center justify-center rounded-xl">
                  <p className="text-gray-500 font-bold">請先新增成員</p>
                </div>
              )}
              <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-700">
                <Plus size={20} className="text-blue-500"/> 新增消費
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">消費項目</label>
                  <input 
                    type="text" 
                    placeholder="例如：晚餐、住宿" 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">金額</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-gray-400">$</span>
                    <input 
                      type="number" 
                      placeholder="0" 
                      className="w-full p-3 pl-8 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono text-lg"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">誰付錢？</label>
                    <select 
                      className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                      value={payerId}
                      onChange={(e) => setPayerId(e.target.value)}
                    >
                      {users.length === 0 && <option>無成員</option>}
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-600">分給誰？</label>
                    <button onClick={selectAllInvolved} className="text-xs text-blue-500 font-medium">全選</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {users.map(u => {
                      const isSelected = involvedIds.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          onClick={() => toggleInvolved(u.id)}
                          className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                            isSelected 
                              ? 'bg-blue-100 border-blue-300 text-blue-800 font-medium' 
                              : 'bg-gray-50 border-gray-200 text-gray-500'
                          }`}
                        >
                          {u.name}
                        </button>
                      )
                    })}
                  </div>
                  {involvedIds.length === 0 && <p className="text-xs text-red-500 mt-1">請至少選擇一人分攤</p>}
                </div>

                <button 
                  onClick={addExpense}
                  disabled={!amount || !description || involvedIds.length === 0 || !payerId}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed mt-2"
                >
                  加入這筆帳
                </button>
              </div>
            </div>

            {/* Recent List Preview */}
            <div className="space-y-3">
              <div className="flex justify-between items-end">
                <h3 className="font-bold text-gray-700">最近紀錄</h3>
                <span className="text-xs text-gray-500">共 {expenses.length} 筆</span>
              </div>
              
              {expenses.length === 0 ? (
                <div className="text-center py-10 text-gray-400 bg-white rounded-xl border border-dashed border-gray-300">
                  <p>還沒有任何紀錄喔！</p>
                  <p className="text-sm">資料會自動同步到雲端</p>
                </div>
              ) : (
                expenses.map(exp => (
                  <div key={exp.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
                    <div>
                      <p className="font-bold text-gray-800">{exp.description}</p>
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-blue-600">{getUserName(exp.payerId)}</span> 先付
                        <span className="mx-1">•</span>
                        {exp.involvedIds.length === users.length ? '所有人分' : `${exp.involvedIds.length} 人分`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold font-mono text-lg">${exp.amount}</span>
                      <button onClick={() => removeExpense(exp.id)} className="text-gray-300 hover:text-red-500">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* --- VIEW: USERS --- */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl shadow-md border border-gray-100">
              <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-700">
                <Users size={20} className="text-purple-500"/> 成員管理
              </h2>
              <div className="flex gap-2 mb-6">
                <input 
                  type="text" 
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="輸入朋友名字"
                  className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && addUser()}
                />
                <button 
                  onClick={addUser}
                  className="bg-purple-600 text-white px-5 rounded-lg font-bold hover:bg-purple-700"
                >
                  新增
                </button>
              </div>

              <div className="space-y-2">
                {users.map(u => (
                  <div key={u.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <span className="font-medium text-gray-700">{u.name}</span>
                    <button 
                      onClick={() => removeUser(u.id)}
                      className="text-gray-400 hover:text-red-500 p-2"
                      title="移除成員"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
                {users.length === 0 && (
                  <p className="text-center text-gray-400 py-4">目前沒有成員，請新增。</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- VIEW: REPORT --- */}
        {activeTab === 'report' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-indigo-500 to-blue-600 text-white p-6 rounded-2xl shadow-lg">
              <h2 className="font-bold text-xl mb-6 flex items-center gap-2">
                <DollarSign size={24} className="text-yellow-300"/> 最佳結算方案
              </h2>

              {settlementReport.transactions.length === 0 ? (
                <div className="text-center py-4 opacity-80">
                  {expenses.length === 0 ? "還沒有任何消費紀錄" : "目前沒有人需要轉帳，帳目已平衡！"}
                </div>
              ) : (
                <div className="space-y-3">
                  {settlementReport.transactions.map((t, idx) => (
                    <div key={idx} className="bg-white/10 backdrop-blur-sm p-4 rounded-xl flex items-center justify-between border border-white/20">
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{t.from}</span>
                        <ArrowRight size={16} className="text-white/60"/>
                        <span className="font-bold">{t.to}</span>
                      </div>
                      <div className="font-mono font-bold text-xl text-yellow-300">
                        ${t.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white p-5 rounded-xl shadow-md border border-gray-100">
              <h3 className="font-bold text-gray-700 mb-4">收支明細</h3>
              <div className="space-y-3">
                {users.map(u => {
                  const bal = settlementReport.balances[u.id] || 0;
                  const isPositive = bal > 0.01;
                  const isNegative = bal < -0.01;
                  
                  return (
                    <div key={u.id} className="flex justify-between items-center p-3 border-b border-gray-100 last:border-0">
                      <span className="text-gray-700">{u.name}</span>
                      <span className={`font-mono font-bold ${
                        isPositive ? 'text-green-600' : 
                        isNegative ? 'text-red-500' : 'text-gray-400'
                      }`}>
                        {isPositive && '+'}{bal.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 flex justify-around p-2 pb-safe shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => setActiveTab('users')}
          className={`flex flex-col items-center p-2 rounded-lg w-full transition-colors ${activeTab === 'users' ? 'text-purple-600 bg-purple-50' : 'text-gray-400'}`}
        >
          <Users size={24} />
          <span className="text-xs font-medium mt-1">成員</span>
        </button>
        <button 
          onClick={() => setActiveTab('expenses')}
          className={`flex flex-col items-center p-2 rounded-lg w-full transition-colors ${activeTab === 'expenses' ? 'text-blue-600 bg-blue-50' : 'text-gray-400'}`}
        >
          <List size={24} />
          <span className="text-xs font-medium mt-1">記帳</span>
        </button>
        <button 
          onClick={() => setActiveTab('report')}
          className={`flex flex-col items-center p-2 rounded-lg w-full transition-colors ${activeTab === 'report' ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400'}`}
        >
          <Calculator size={24} />
          <span className="text-xs font-medium mt-1">結算</span>
        </button>
      </nav>
    </div>
  );
}