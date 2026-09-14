---
title: 把代码和理解写在一起
summary: 用普通 Markdown 保存标题、代码、注释和待办，让一篇笔记既能阅读，也能用于下一次实践。
category: 技术
tags: [Markdown, 代码, 写作]
created: 2026-09-13T08:00:00.000Z
updated: 2026-09-14T00:00:00.000Z
publishedAt: 2026-09-14T00:00:00.000Z
approvedAt: 2026-09-14T00:00:00.000Z
publish: true
status: published
---

一篇技术笔记除了结论，还应该包含适用条件、可以运行的例子，以及自己的解释。

## 一个最小例子

下面的函数把标签去重，同时保留第一次出现的顺序。

```python title="tags.py"
def unique_tags(tags):
    # dict 保留插入顺序，因此不会打乱原来的标签顺序。
    return list(dict.fromkeys(tag.strip() for tag in tags if tag.strip()))

print(unique_tags(["Python", " Markdown ", "Python"]))
# ['Python', 'Markdown']
```

## 为下一次使用留下信息

| 内容     | 记录方式             |
| -------- | -------------------- |
| 前提条件 | 运行环境、版本、依赖 |
| 操作步骤 | 有顺序的列表         |
| 代码解释 | 代码内注释与相邻段落 |
| 后续问题 | 待办列表或独立笔记   |

> [!tip] 注释
> 好的注释解释原因。容易从代码读出的行为，不必重复一遍。

## 待办与引用

- [x] 保存一个可运行的例子
- [ ] 补充实际项目中的使用记录

进一步阅读 [[connected-notes|如何让笔记彼此关联]]，也可以回到 [[about|这座知识库的起点]]。
