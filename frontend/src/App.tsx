import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Upload, ShoppingCart,
  Package, ArrowLeftRight, ClipboardList, Repeat2, Trash2,
  Box, Tag, Truck, FileText, Wrench,
  ChefHat, Layers,
  ChevronDown,
} from 'lucide-react'

import Dashboard            from './pages/Dashboard'
import Import               from './pages/Import'
import Purchases            from './pages/Purchases'
import Inventory            from './pages/Inventory'
import InventoryDetail      from './pages/InventoryDetail'
import Movements            from './pages/Movements'
import StockCount           from './pages/StockCount'
import StockCountDetail     from './pages/StockCountDetail'
import Transfers            from './pages/Transfers'
import Waste                from './pages/Waste'
import Products             from './pages/Products'
import Categories           from './pages/Categories'
import Suppliers            from './pages/Suppliers'
import Invoices             from './pages/Invoices'
import Recipes              from './pages/Recipes'
import IntermediateProducts from './pages/IntermediateProducts'
import Services             from './pages/Services'
import MobileCount          from './pages/MobileCount'

import './app-layout.css'

type NavItem    = { to: string; label: string; icon: React.ReactNode }
type NavSection = { label: string; sectionIcon: React.ReactNode; links: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    sectionIcon: <LayoutDashboard size={15} />,
    links: [
      { to: '/',          label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
      { to: '/import',    label: 'Import',    icon: <Upload size={16} /> },
      { to: '/purchases', label: 'Purchases', icon: <ShoppingCart size={16} /> },
    ],
  },
  {
    label: 'Inventory Ops',
    sectionIcon: <Package size={15} />,
    links: [
      { to: '/inventory',   label: 'Inventory',   icon: <Package size={16} /> },
      { to: '/movements',   label: 'Movements',   icon: <ArrowLeftRight size={16} /> },
      { to: '/stock-count', label: 'Stock Count', icon: <ClipboardList size={16} /> },
      { to: '/transfers',   label: 'Transfers',   icon: <Repeat2 size={16} /> },
      { to: '/waste',       label: 'Waste',       icon: <Trash2 size={16} /> },
    ],
  },
  {
    label: 'Catalog',
    sectionIcon: <Box size={15} />,
    links: [
      { to: '/products',   label: 'Products',             icon: <Box size={16} /> },
      { to: '/categories', label: 'Categories',           icon: <Tag size={16} /> },
      { to: '/services',   label: 'Services & Guarantees', icon: <Wrench size={16} /> },
      { to: '/suppliers',  label: 'Suppliers',            icon: <Truck size={16} /> },
      { to: '/invoices',   label: 'Invoices',             icon: <FileText size={16} /> },
    ],
  },
  {
    label: 'Production',
    sectionIcon: <ChefHat size={15} />,
    links: [
      { to: '/recipes',               label: 'Recipes',               icon: <ChefHat size={16} /> },
      { to: '/intermediate-products', label: 'Intermediate Products', icon: <Layers size={16} /> },
    ],
  },
]

function SidebarContent() {
  const location = useLocation()
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    NAV_SECTIONS.forEach(s => {
      init[s.label] = s.links.some(l =>
        l.to === '/' ? location.pathname === '/' : location.pathname.startsWith(l.to)
      )
    })
    return init
  })

  const toggle = (label: string) =>
    setOpen(prev => ({ ...prev, [label]: !prev[label] }))

  return (
    <nav style={{
      width: 230,
      minHeight: '100vh',
      background: '#0f0e1a',
      color: '#a5b4fc',
      padding: '1.25rem 0 2rem',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ padding: '1rem 1.1rem 1.25rem', borderBottom: '1px solid #1f2937', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <img
          src="/logo.jpg"
          alt="Zúbro"
          style={{ width: 140, height: 140, objectFit: 'contain', display: 'block', filter: 'invert(1)', mixBlendMode: 'screen' }}
        />
        <div style={{ fontSize: '.72rem', color: '#6366f1', fontWeight: 500, marginTop: 2, textAlign: 'center' }}>
          Food Cost Manager
        </div>
      </div>

      {NAV_SECTIONS.map(section => {
        const isOpen = open[section.label]
        const count  = section.links.length
        return (
          <div key={section.label}>
            <button
              onClick={() => toggle(section.label)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '.45rem 1.1rem', background: 'none', border: 'none',
                cursor: 'pointer', color: '#818cf8',
              }}
            >
              <span style={{ opacity: .8 }}>{section.sectionIcon}</span>
              <span style={{ flex: 1, textAlign: 'left', fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                {section.label}
              </span>
              <span style={{
                background: '#1e1b4b', color: '#a5b4fc', borderRadius: 99,
                fontSize: '.65rem', fontWeight: 700, padding: '1px 7px', minWidth: 20, textAlign: 'center',
              }}>
                {count}
              </span>
              <ChevronDown
                size={13}
                style={{ transition: 'transform .2s', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', opacity: .7 }}
              />
            </button>

            {isOpen && (
              <div style={{ paddingBottom: 4 }}>
                {section.links.map(link => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === '/'}
                    style={({ isActive }) => ({
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '.5rem 1rem', margin: '2px .6rem',
                      borderRadius: 8, textDecoration: 'none', fontSize: '.88rem',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? '#fff' : '#c7d2fe',
                      background: isActive ? '#4f46e5' : 'transparent',
                    })}
                  >
                    {link.icon}
                    {link.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function Layout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <SidebarContent />
      <main style={{ flex: 1, padding: '2rem', overflowY: 'auto', background: '#f9fafb' }}>
        <Routes>
          <Route path="/"                        element={<Dashboard />} />
          <Route path="/import"                  element={<Import />} />
          <Route path="/purchases"               element={<Purchases />} />
          <Route path="/inventory"               element={<Inventory />} />
          <Route path="/inventory/:productId"    element={<InventoryDetail />} />
          <Route path="/movements"               element={<Movements />} />
          <Route path="/stock-count"             element={<StockCount />} />
          <Route path="/stock-count/:sessionId"  element={<StockCountDetail />} />
          <Route path="/transfers"               element={<Transfers />} />
          <Route path="/waste"                   element={<Waste />} />
          <Route path="/products"                element={<Products />} />
          <Route path="/categories"              element={<Categories />} />
          <Route path="/suppliers"               element={<Suppliers />} />
          <Route path="/invoices"                element={<Invoices />} />
          <Route path="/recipes"                 element={<Recipes />} />
          <Route path="/intermediate-products"   element={<IntermediateProducts />} />
          <Route path="/services"               element={<Services />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/count/:sessionId" element={<MobileCount />} />
        <Route path="*" element={<Layout />} />
      </Routes>
    </BrowserRouter>
  )
}