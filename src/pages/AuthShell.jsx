import React, { useContext, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../components.jsx'
import { clinic } from '../clinic-config.js'
import { PublicHeader, PublicFooter } from './PublicChrome.jsx'
import { PublicSite } from './PublicSite.jsx'
import { isPublicAuthView, publicViewFromHash } from '../public-route.js'
import { InAccountDialog } from './account-dialog-context.js'

export function PublicAccountEntry({ children, onNavigate, onDismiss }) {
  const dialog = useRef(null)
  const closeButton = useRef(null)
  const returnFocus = useRef(null)
  const returnScroll = useRef(0)
  const [previousContent, setPreviousContent] = useState(null)
  const backdropPress = useRef(false)
  const open = Boolean(children)

  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const node = dialog.current
    if (!open || !viewport) return
    const fitViewport = () => {
      const compact = viewport.height < 420
      node.style.setProperty('--lp-auth-viewport-height', `${viewport.height}px`)
      node.style.setProperty('--lp-auth-viewport-top', `${viewport.offsetTop}px`)
      node.toggleAttribute('data-compact-viewport', compact)
      const field = document.activeElement
      if ((compact || viewport.height < window.innerHeight) && node.contains(field) && field.matches('input, textarea, select')) {
        field.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      }
    }
    fitViewport()
    viewport.addEventListener('resize', fitViewport)
    viewport.addEventListener('scroll', fitViewport)
    return () => {
      viewport.removeEventListener('resize', fitViewport)
      viewport.removeEventListener('scroll', fitViewport)
    }
  }, [open])

  useLayoutEffect(() => {
    const node = dialog.current
    if (children) {
      setPreviousContent(children)
      if (!node.open) {
        returnScroll.current = window.scrollY
        window.scrollTo({ top: 0, behavior: 'instant' })
        node.showModal()
      }
      if (!node.contains(document.activeElement)) closeButton.current.focus({ preventScroll: true })
      return
    }
    if (!node.open) return

    const restoreLanding = () => {
      node.close()
      window.scrollTo({ top: returnScroll.current, behavior: 'instant' })
      const trigger = returnFocus.current
      const fallback = trigger?.closest('.lp-nav')?.parentElement.querySelector('.lp-menu-toggle')
      const target = [trigger, fallback].find(element => element?.isConnected && element.getClientRects().length)
      const focusTarget = target || document.getElementById('lp-hero-title')
      focusTarget?.focus({ preventScroll: true })
      returnFocus.current = null
      setPreviousContent(null)
    }
    const exitTime = parseFloat(getComputedStyle(node).getPropertyValue('--lp-dialog-exit'))
    const timeout = window.setTimeout(restoreLanding, exitTime)
    return () => window.clearTimeout(timeout)
  }, [children])

  const followAuthLink = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.target.closest('a[href]')
    const href = link?.getAttribute('href')
    if (!href?.startsWith('#') || link.target || !isPublicAuthView(publicViewFromHash(href))) return
    event.preventDefault()
    if (!open) returnFocus.current = link
    onNavigate(href, !open)
  }

  return <PublicSite onClick={followAuthLink}>
    <dialog ref={dialog} className={`lp-auth-dialog public-auth${open ? '' : ' is-closing'}`} role="dialog" aria-modal="true" aria-labelledby="lp-account-dialog-title"
      onCancel={event => { event.preventDefault(); if (open) onDismiss() }}
      onPointerDown={event => { backdropPress.current = event.target === event.currentTarget }}
      onPointerCancel={() => { backdropPress.current = false }}
      onClick={event => {
        if (open && backdropPress.current && event.target === event.currentTarget && !dialog.current.querySelector('[aria-busy="true"]')) onDismiss()
        backdropPress.current = false
      }}>
      <div className="auth-card lp-dialog-card" inert={!open || undefined}>
        <div className="lp-dialog-chrome">
          <span id="lp-account-dialog-title" className="sr-only">Clinic account</span>
          <img src={clinic.logo} alt="" width="32" height="32"/>
          <button ref={closeButton} className="lp-dialog-close" type="button" aria-label="Close account panel" onClick={onDismiss}><Icon name="x" size={20}/></button>
        </div>
        <div className="lp-dialog-body">
          <InAccountDialog.Provider value={true}>{children || previousContent}</InAccountDialog.Provider>
        </div>
      </div>
    </dialog>
  </PublicSite>
}

export function AuthShell({ children }) {
  const inDialog = useContext(InAccountDialog)
  if (inDialog) return children
  return <div className="lp-site public-auth">
    <PublicHeader/>
    <main id="public-main" tabIndex={-1} className="lp-auth auth-shell site-ready">
      <div className="lp-auth-side">
        <div className="auth-card">{children}</div>
        <div className="lp-auth-help">
          <a href="#home" className="lp-auth-back"><Icon name="arrow" size={16}/>Clinic website</a>
          <a href={`tel:${clinic.phoneE164}`}><Icon name="phone" size={16}/>Call the clinic</a>
        </div>
      </div>
    </main>
    <PublicFooter/>
  </div>
}
