import { createElement, PanelLeftOpen, PanelLeftClose, Scan, X } from "lucide"

document.addEventListener("nav", () => {
  const map = document.querySelector<HTMLElement>(".knowledge-map")
  if (!map) return
  const sidebar = document.querySelector<HTMLElement>(".sidebar.left")!
  sidebar.id = "home-directory"
  const toggle = map.querySelector<HTMLButtonElement>(".map-directory-toggle")!
  const directoryIcon = toggle.querySelector<HTMLElement>("[data-map-icon]")!
  const mobile = window.matchMedia("(max-width: 800px)")
  map.querySelector('[data-map-icon="overview"]')!.append(createElement(Scan))
  map.querySelectorAll('[data-map-icon="close"]').forEach((icon) => icon.append(createElement(X)))
  const setCollapsed = (collapsed: boolean) => {
    document.body.classList.toggle("map-directory-collapsed", collapsed)
    sidebar.inert = collapsed
    toggle.setAttribute("aria-expanded", String(!collapsed))
    const label = collapsed ? "展开目录" : "收起目录"
    toggle.setAttribute("aria-label", label)
    toggle.title = label
    directoryIcon.replaceChildren(createElement(collapsed ? PanelLeftOpen : PanelLeftClose))
  }
  setCollapsed(mobile.matches)
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const scene = map.querySelector<HTMLElement>(".map-scene")!
  const overview = map.querySelector<HTMLButtonElement>(".map-overview")!
  toggle.addEventListener(
    "click",
    () => setCollapsed(toggle.getAttribute("aria-expanded") === "true"),
    options,
  )
  let selected: HTMLButtonElement | undefined
  const showOverview = () => {
    scene.style.transform = "translate(0, 0) scale(1)"
    overview.disabled = true
    map.classList.remove("is-focused")
    selected = undefined
  }
  const close = (resetView = false) => {
    map.querySelectorAll<HTMLElement>(".map-preview").forEach((p) => (p.hidden = true))
    selected?.setAttribute("aria-expanded", "false")
    if (resetView) showOverview()
  }
  const focusNode = (node: HTMLButtonElement) => {
    const zoom = mobile.matches ? 1.08 : 1.14
    // Use layout coordinates, never the node's already animated screen position.
    // Percentage translation keeps the target centered when the directory or viewport resizes.
    const offsetX = (50 - Number(node.dataset.x)) * zoom
    const offsetY = (50 - Number(node.dataset.y)) * zoom
    scene.style.transform = `translate(${offsetX}%, ${offsetY}%) scale(${zoom})`
    overview.disabled = false
    map.classList.add("is-focused")
  }
  const reset = () => {
    const previous = selected
    close(true)
    previous?.focus({ preventScroll: true })
  }
  mobile.addEventListener(
    "change",
    () => {
      if (selected) focusNode(selected)
    },
    options,
  )
  map.querySelectorAll<HTMLButtonElement>(".map-node").forEach((node) => {
    node.addEventListener(
      "click",
      () => {
        close()
        selected = node
        node.setAttribute("aria-expanded", "true")
        focusNode(node)
        document.getElementById(node.dataset.preview!)!.hidden = false
      },
      options,
    )
  })
  map
    .querySelectorAll<HTMLButtonElement>(".map-close")
    .forEach((button) => button.addEventListener("click", reset, options))
  overview.addEventListener("click", reset, options)
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !document.querySelector(".search-container.active")) {
        reset()
      }
    },
    options,
  )
  window.addCleanup(() => {
    controller.abort()
    sidebar.inert = false
    sidebar.removeAttribute("id")
    document.body.classList.remove("map-directory-collapsed")
  })
})
