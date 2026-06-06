import React, { useState, useEffect, useRef } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import {
    ShieldCheck, LayoutDashboard, Activity, Users, Briefcase, LogOut,
    Clock, FileText, Search, Zap, Globe, DollarSign, BarChart3, UserCheck
} from "lucide-react";
import API_BASE_URL, { BACKEND_URL } from "./apiConfig";
import Logo from "./components/Logo";

const WS_BASE = BACKEND_URL.replace(/^http/, "ws");

const SidebarLink = ({ to, icon: Icon, label }) => (
    <NavLink to={to}
        className={({ isActive }) => `font-medium px-4 py-2.5 rounded-xl transition-all flex items-center gap-2.5 text-sm ${isActive ? "bg-[#0a2a5e]/10 text-[#0a2a5e]" : "text-gray-600 hover:bg-[#0a2a5e]/5 hover:text-[#0a2a5e]"}`}>
        <Icon className="w-[18px] h-[18px]" />{label}
    </NavLink>
);

const ACTION_COLOR = (t) => ({
    user_login: "#22c55e", user_register: "#3b82f6", superuser_login: "#0a2a5e",
    superuser_create: "#7c3aed", cv_upload: "#f59e0b", cv_screen: "#ec4899",
    cv_screen_batch: "#ec4899", jd_upload: "#06b6d4", resume_analyze: "#8b5cf6",
}[t] || "#6b7280");

const ACTION_LABEL = (t) => ({
    user_login: "Login", user_register: "Register", superuser_login: "Admin Login",
    superuser_create: "Admin Created", cv_upload: "CV Upload", cv_screen: "CV Screen",
    cv_screen_batch: "Batch Screen", jd_upload: "JD Upload", resume_analyze: "Resume Analysis",
}[t] || t);

const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
const fmtDate = (ts) => ts ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

const SuperuserDashboard = () => {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [stats, setStats] = useState(null);
    const [recentLogs, setRecentLogs] = useState([]);
    const [liveFeed, setLiveFeed] = useState([]);
    const wsRef = useRef(null);
    const token = localStorage.getItem("superuserToken");

    useEffect(() => {
        const u = localStorage.getItem("superuserUser");
        if (u) setUser(JSON.parse(u));
        else navigate("/superuser/signin");
    }, [navigate]);

    useEffect(() => {
        if (!token) return;
        const fetch = async () => {
            try {
                const res = await window.fetch(`${API_BASE_URL}/superuser/dashboard/stats`, { headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) setStats(await res.json());
            } catch { }
        };
        fetch();
        const iv = setInterval(fetch, 30000);
        return () => clearInterval(iv);
    }, [token]);

    useEffect(() => {
        if (!token) return;
        (async () => {
            try {
                const res = await window.fetch(`${API_BASE_URL}/superuser/activity-logs?limit=25`, { headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) { const d = await res.json(); setRecentLogs(d.logs || []); }
            } catch { }
        })();
    }, [token]);

    useEffect(() => {
        if (!token) return;
        const ws = new WebSocket(`${WS_BASE}/ws/superuser/activity-feed?token=${token}`);
        wsRef.current = ws;
        ws.onmessage = (e) => {
            try { const d = JSON.parse(e.data); if (d.action_type) setLiveFeed(prev => [d, ...prev].slice(0, 60)); } catch { }
        };
        const ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 25000);
        return () => { clearInterval(ping); ws.close(); };
    }, [token]);

    const handleLogout = () => { localStorage.removeItem("superuserToken"); localStorage.removeItem("superuserUser"); navigate("/superuser/signin"); };

    if (!user) return <div className="h-screen flex items-center justify-center bg-gray-50"><div className="w-8 h-8 border-2 border-[#0a2a5e] border-t-transparent rounded-full animate-spin" /></div>;

    const statCards = stats ? [
        { label: "Total API Cost", value: `$${(stats.total_api_cost_usd || 0).toFixed(4)}`, icon: DollarSign, color: "#0a2a5e", badge: `${(stats.total_tokens_used || 0).toLocaleString()} tokens` },
        { label: "Total Candidates", value: stats.total_candidates, icon: Users, color: "#0a2a5e" },
        { label: "Total Recruiters", value: stats.total_recruiters, icon: Briefcase, color: "#0a2a5e" },
        { label: "Job Postings", value: stats.total_job_postings, icon: FileText, color: "#0a2a5e" },
        { label: "CVs Screened", value: stats.total_screenings, icon: Search, color: "#0a2a5e" },
        { label: "Logins Today", value: stats.logins_today, icon: UserCheck, color: "#0a2a5e" },
    ] : [];

    return (
        <div className="h-screen w-screen flex bg-gradient-to-br from-gray-50 to-gray-100 overflow-hidden fixed inset-0">
            <aside className="w-72 h-screen bg-white shadow-xl flex flex-col p-6 border-r border-gray-200 flex-shrink-0">
                <div className="mb-8 text-center">
                    <div className="flex items-center justify-center gap-2">
                        <Logo className="h-8 w-auto" />
                    </div>
                    <span className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-[#0a2a5e]/70 bg-[#0a2a5e]/5 px-3 py-1 rounded-full"><ShieldCheck className="w-3.5 h-3.5" /> Admin Panel</span>
                </div>
                <nav className="flex flex-col space-y-1">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 mb-1">Overview</p>
                    <SidebarLink to="/superuser/dashboard" icon={LayoutDashboard} label="Dashboard" />
                    <SidebarLink to="/superuser/activity-logs" icon={Activity} label="Activity Logs" />
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 mt-5 mb-1">Monitoring</p>
                    <SidebarLink to="/superuser/candidates" icon={Users} label="Candidates" />
                    <SidebarLink to="/superuser/recruiters" icon={Briefcase} label="Recruiters" />
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 mt-5 mb-1">Administration</p>
                    <SidebarLink to="/superuser/admins" icon={ShieldCheck} label="Admin Accounts" />
                </nav>
                <div className="mt-auto space-y-3">
                    {user && <div className="bg-[#0a2a5e]/5 rounded-xl p-3">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Signed in as</p>
                        <p className="text-sm font-semibold text-[#0a2a5e] truncate">{user.firstName} {user.lastName}</p>
                        <p className="text-xs text-gray-400 truncate">{user.email}</p>
                        {user.isRoot && <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full mt-1 inline-block">Root Admin</span>}
                    </div>}
                    <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-red-500 to-red-600 px-4 py-3 rounded-xl text-white hover:from-red-600 hover:to-red-700 transition-all shadow-md text-sm font-medium">
                        <LogOut className="w-4 h-4" /> Logout
                    </button>
                </div>
            </aside>

            <main className="flex-1 h-screen flex flex-col overflow-hidden p-6">
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-5 flex-shrink-0">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">Monitoring Dashboard</h2>
                        <p className="text-gray-500 text-sm mt-1">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-50 text-green-600 border border-green-200">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
                    </span>
                </motion.div>

                {/* KPI Cards */}
                <div className="grid grid-cols-6 gap-3 mb-5 flex-shrink-0">
                    {statCards.map((card, i) => (
                        <motion.div key={card.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                            className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: `${card.color}10` }}>
                                <card.icon className="w-5 h-5" style={{ color: card.color }} />
                            </div>
                            <p className="text-xl font-bold text-gray-900">{card.value ?? "—"}</p>
                            {card.badge && <p className="text-[10px] text-gray-400 mt-0.5">{card.badge}</p>}
                            <p className="text-xs text-gray-500 mt-1 leading-tight">{card.label}</p>
                        </motion.div>
                    ))}
                </div>

                {/* Bottom panels */}
                <div className="flex-1 grid grid-cols-2 gap-4 overflow-hidden min-h-0">
                    {/* Live Feed */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex items-center gap-2 flex-shrink-0">
                            <Zap className="w-5 h-5 text-amber-500" />
                            <h3 className="text-gray-900 font-semibold text-sm">Live Activity Feed</h3>
                            <span className="ml-auto text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{liveFeed.length} events</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                            {liveFeed.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-gray-400 py-8">
                                    <Globe className="w-10 h-10 mb-2 opacity-20" />
                                    <p className="text-sm">Waiting for live events…</p>
                                    <p className="text-xs text-gray-300 mt-1">User actions appear here in real time</p>
                                </div>
                            ) : liveFeed.map((ev, i) => (
                                <motion.div key={ev._id || i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                                    className="flex items-start gap-2.5 p-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: ACTION_COLOR(ev.action_type) }} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                                                style={{ background: `${ACTION_COLOR(ev.action_type)}15`, color: ACTION_COLOR(ev.action_type) }}>
                                                {ACTION_LABEL(ev.action_type)}
                                            </span>
                                            <span className="text-xs text-gray-400">{fmtTime(ev.timestamp)}</span>
                                        </div>
                                        <p className="text-xs text-gray-600 mt-0.5 truncate font-medium">{ev.user_email}</p>
                                        <p className="text-[10px] text-gray-400 capitalize">{ev.user_role}</p>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    {/* Recent Activity Table */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex items-center gap-2 flex-shrink-0">
                            <Clock className="w-5 h-5 text-[#0a2a5e]" />
                            <h3 className="text-gray-900 font-semibold text-sm">Recent Activity</h3>
                            <button onClick={() => navigate("/superuser/activity-logs")} className="ml-auto text-xs text-[#0a2a5e] hover:underline font-medium">View All →</button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-gray-50">
                                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                                        <th className="py-2.5 px-4 font-medium">Time</th>
                                        <th className="py-2.5 px-4 font-medium">User</th>
                                        <th className="py-2.5 px-4 font-medium">Action</th>
                                        <th className="py-2.5 px-4 font-medium">Role</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentLogs.map((log, i) => (
                                        <tr key={log._id || i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                            <td className="py-2 px-4 text-xs text-gray-400 whitespace-nowrap">{fmtDate(log.timestamp)}</td>
                                            <td className="py-2 px-4 text-gray-700 truncate max-w-[130px] text-xs">{log.user_email}</td>
                                            <td className="py-2 px-4">
                                                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                                                    style={{ background: `${ACTION_COLOR(log.action_type)}12`, color: ACTION_COLOR(log.action_type) }}>
                                                    {ACTION_LABEL(log.action_type)}
                                                </span>
                                            </td>
                                            <td className="py-2 px-4 text-xs text-gray-400 capitalize">{log.user_role}</td>
                                        </tr>
                                    ))}
                                    {recentLogs.length === 0 && <tr><td colSpan="4" className="py-10 text-center text-gray-400 text-sm">No activity recorded yet</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default SuperuserDashboard;
