document.addEventListener("nav", () => {
  const map = document.querySelector<HTMLElement>(".knowledge-map")
  if (!map) return
  const sidebar = document.querySelector<HTMLElement>(".sidebar.left")!
  sidebar.id = "home-directory"
  const toggle = map.querySelector<HTMLButtonElement>(".map-directory-toggle")!
  const setCollapsed = (collapsed: boolean) => {
    document.body.classList.toggle("map-directory-collapsed", collapsed)
    sidebar.inert = collapsed
    toggle.setAttribute("aria-expanded", String(!collapsed))
    toggle.textContent = collapsed ? "展开目录" : "收起目录"
  }
  setCollapsed(window.innerWidth < 800)
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
  }
  const close = (resetView = false) => {
    map.querySelectorAll<HTMLElement>(".map-preview").forEach((p) => (p.hidden = true))
    selected?.setAttribute("aria-expanded", "false")
    if (resetView) showOverview()
  }
  const focusNode = (node: HTMLButtonElement) => {
    const zoom = window.matchMedia("(max-width: 800px)").matches ? 1.08 : 1.14
    const stageBounds = scene.parentElement!.getBoundingClientRect()
    const nodeBounds = node.getBoundingClientRect()
    const offsetX =
      stageBounds.left + stageBounds.width / 2 - (nodeBounds.left + nodeBounds.width / 2)
    const offsetY =
      stageBounds.top + stageBounds.height / 2 - (nodeBounds.top + nodeBounds.height / 2)
    scene.style.transform = `translate(${offsetX * zoom}px, ${offsetY * zoom}px) scale(${zoom})`
    overview.disabled = false
    map.classList.add("is-focused")
  }
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
  map.querySelectorAll<HTMLButtonElement>(".map-close").forEach((button) =>
    button.addEventListener(
      "click",
      () => {
        close(true)
        selected?.focus()
      },
      options,
    ),
  )
  overview.addEventListener(
    "click",
    () => {
      close(true)
      selected?.focus()
    },
    options,
  )
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        close(true)
        selected?.focus()
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
