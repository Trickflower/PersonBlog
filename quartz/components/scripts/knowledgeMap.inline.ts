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
  toggle.addEventListener(
    "click",
    () => setCollapsed(toggle.getAttribute("aria-expanded") === "true"),
    options,
  )
  let selected: HTMLButtonElement | undefined
  const close = () => {
    map.querySelectorAll<HTMLElement>(".map-preview").forEach((p) => (p.hidden = true))
    selected?.setAttribute("aria-expanded", "false")
  }
  map.querySelectorAll<HTMLButtonElement>(".map-node").forEach((node) => {
    node.addEventListener(
      "click",
      () => {
        close()
        selected = node
        node.setAttribute("aria-expanded", "true")
        document.getElementById(node.dataset.preview!)!.hidden = false
      },
      options,
    )
  })
  map.querySelectorAll<HTMLButtonElement>(".map-close").forEach((button) =>
    button.addEventListener(
      "click",
      () => {
        close()
        selected?.focus()
      },
      options,
    ),
  )
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        close()
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
