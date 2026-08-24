import { Outlet, useLocation } from 'react-router-dom'
import { Nav } from './Nav'
import { Footer } from './Footer'
import { Cursor } from './Cursor'
import { FontLoadBar } from '../FontLoadBar'

export function Layout() {
  const location = useLocation()

  return (
    <>
      <FontLoadBar />
      <Cursor />
      <div className="page">
        <Nav />
        {/* key=pathname：路由切换时重放淡入动画（reduced-motion 下自动关闭） */}
        <div className="route-fade" key={location.pathname}>
          <Outlet />
        </div>
        <Footer />
      </div>
    </>
  )
}
