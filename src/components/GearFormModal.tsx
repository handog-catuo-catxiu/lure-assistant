import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import BrandPicker from './BrandPicker'
import CatalogPicker from './CatalogPicker'
import GearImage from './GearImage'
import Modal from './Modal'
import ToggleSwitch from './ToggleSwitch'
import { CATEGORY_ICONS, CloseIcon } from './icons'
import { findCatalogProduct } from '../lib/gearImage'
import { toImageErrorMessage, validateImageFile } from '../lib/imageStore'
import {
  ACCESSORY_TYPE_FIELD,
  CATEGORY_META,
  CATEGORY_ORDER,
  SPEC_FIELDS,
  isSelectField,
  todayISO,
  type GearCategory,
  type GearDraft,
  type GearItem,
  type GearSpec,
  type SpecKey,
} from '../types/gear'
import type { CatalogProduct } from '../types/catalog'
import './GearFormModal.css'

const FORM_ID = 'gear-form'

/** 名称输入框的示例，按分类给一个贴近的写法 */
const NAME_PLACEHOLDER: Record<GearCategory, string> = {
  rod: '月影 MX 直柄',
  reel: '月影 MX 2500S',
  lure: '浮水米诺 95F',
  accessory: '溪流路亚包',
}

/** 表单里暂存的图片改动，保存时由外部写进 IndexedDB */
export interface GearImageChange {
  /** 新选择的照片 */
  file?: File
  /** 是否要删除已有照片 */
  remove?: boolean
}

interface GearFormModalProps {
  /** 传入装备表示编辑，否则为新增 */
  initial?: GearItem | null
  /** 新增时的默认分类（跟随首页当前筛选） */
  defaultCategory?: GearCategory
  /** 编辑时已有照片的预览地址 */
  currentImageUrl?: string | null
  onCancel: () => void
  onSubmit: (draft: GearDraft, imageChange: GearImageChange) => void
}

export default function GearFormModal({
  initial = null,
  defaultCategory = 'rod',
  currentImageUrl = null,
  onCancel,
  onSubmit,
}: GearFormModalProps) {
  const isEditing = initial !== null

  const [category, setCategory] = useState<GearCategory>(
    initial?.category ?? defaultCategory,
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [brand, setBrand] = useState(initial?.brand ?? '')
  // 保留所有分类已填过的规格，切换分类再切回来内容不丢，提交时只取当前分类用到的字段
  const [spec, setSpec] = useState<GearSpec>(initial?.spec ?? {})
  const [note, setNote] = useState(initial?.note ?? '')
  const [purchasedAt, setPurchasedAt] = useState(
    initial?.purchasedAt || todayISO(),
  )
  const [favorite, setFavorite] = useState(initial?.favorite ?? false)
  const [catalogId, setCatalogId] = useState<string | undefined>(
    initial?.catalogId,
  )
  const [error, setError] = useState<string | null>(null)

  // 图片相关
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [pickedPreviewUrl, setPickedPreviewUrl] = useState<string | null>(null)
  const [imageRemoved, setImageRemoved] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  const previewUrlRef = useRef<string | null>(null)

  // 只释放本组件自己创建的地址，父组件传进来的地址由父组件管理
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    [],
  )

  const selectedProduct = useMemo(
    () => findCatalogProduct(catalogId),
    [catalogId],
  )

  /** 已填的周边类型不在内置列表里（旧数据或以后新增的写法），补成一个选项免得被改掉 */
  const customAccessoryType = useMemo(() => {
    const current = spec.accessoryType?.trim() ?? ''
    if (!current) return null
    const options = ACCESSORY_TYPE_FIELD.options ?? []
    return options.includes(current) ? null : current
  }, [spec.accessoryType])

  // 有固定选项的规格字段（周边类型）在分类下方单独渲染，不重复出现在两列规格区
  const plainSpecFields = SPEC_FIELDS[category].filter(
    (field) => !isSelectField(field),
  )

  /** 当前要预览的图片地址 */
  const previewUrl =
    pickedPreviewUrl ?? (imageRemoved ? null : currentImageUrl ?? null)

  function handleSpecChange(key: SpecKey, value: string) {
    setSpec((prev) => {
      const next: GearSpec = { ...prev }
      next[key] = value
      return next
    })
  }

  function handleCategoryChange(next: GearCategory) {
    setCategory(next)
    // 手动改分类后，原来选的图鉴产品已经对不上了，取消关联
    setCatalogId((current) => {
      const product = findCatalogProduct(current)
      return product && product.category === next ? current : undefined
    })
  }

  function handleSelectProduct(product: CatalogProduct) {
    setCategory(product.category)
    setBrand(product.brand)
    setName(product.name)
    setSpec({ ...product.spec })
    setCatalogId(product.id)
    setPickerOpen(false)
    setError(null)
  }

  function releasePickedPreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPickedPreviewUrl(null)
  }

  function handlePickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 清空 value，否则连续选同一个文件不会触发 change
    event.target.value = ''
    if (!file) return

    try {
      validateImageFile(file)
    } catch (err) {
      setImageError(toImageErrorMessage(err))
      return
    }

    releasePickedPreview()
    const url = URL.createObjectURL(file)
    previewUrlRef.current = url

    setPickedFile(file)
    setPickedPreviewUrl(url)
    setImageRemoved(false)
    setImageError(null)
  }

  function handleRemoveImage() {
    releasePickedPreview()
    setPickedFile(null)
    setImageError(null)
    // 只有本来就存在照片时才需要通知外部删除
    setImageRemoved(Boolean(currentImageUrl))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('请先填写装备名称')
      return
    }

    const cleanedSpec: GearSpec = {}
    for (const field of SPEC_FIELDS[category]) {
      const value = spec[field.key]?.trim()
      if (value) cleanedSpec[field.key] = value
    }

    const imageChange: GearImageChange = {}
    if (pickedFile) imageChange.file = pickedFile
    else if (imageRemoved) imageChange.remove = true

    onSubmit(
      {
        name: trimmedName,
        category,
        brand: brand.trim(),
        spec: cleanedSpec,
        note: note.trim(),
        purchasedAt: purchasedAt || todayISO(),
        favorite,
        catalogId,
        // 首页展示开关只在详情页里改，编辑装备时原样带过去，避免保存时把它重置
        showImageOnHome: initial?.showImageOnHome ?? false,
      },
      imageChange,
    )
  }

  return (
    <Modal
      title={isEditing ? '编辑装备' : '添加装备'}
      subtitle={isEditing ? '修改后点击保存即可' : '记录你的装备，出门前心里有数'}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            取消
          </button>
          <button type="submit" form={FORM_ID} className="btn btn--primary">
            {isEditing ? '保存修改' : '确认添加'}
          </button>
        </>
      }
    >
      <form id={FORM_ID} className="form" onSubmit={handleSubmit} noValidate>
        <CatalogPicker
          open={pickerOpen}
          currentCategory={category}
          selectedId={catalogId}
          onToggle={() => setPickerOpen((open) => !open)}
          onSelect={handleSelectProduct}
        />

        {selectedProduct && (
          <p className="form__picked">
            已填入图鉴产品「{selectedProduct.brand} {selectedProduct.name}」的信息，可以继续修改
          </p>
        )}

        <div className="form__row">
          <span className="form__label">装备分类</span>
          <div className="segmented" role="group" aria-label="装备分类">
            {CATEGORY_ORDER.map((key) => {
              const Icon = CATEGORY_ICONS[key]
              const active = category === key
              return (
                <button
                  key={key}
                  type="button"
                  className={`segmented__item${active ? ' segmented__item--active' : ''}`}
                  data-category={key}
                  aria-pressed={active}
                  onClick={() => handleCategoryChange(key)}
                >
                  <Icon size={20} />
                  <span>{CATEGORY_META[key].label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/*
          周边类型：只在「周边装备」下出现，位置紧跟分类。
          存的是 spec.accessoryType，所以详情页、列表摘要、搜索都会自动带上它。
          已经存过自定义写法的旧数据也照常显示（下面把当前值补成一个选项）。
        */}
        {category === 'accessory' && (
          <div className="form__row">
            <label className="form__label" htmlFor="gear-spec-accessoryType">
              {ACCESSORY_TYPE_FIELD.label}
              <em>选填</em>
            </label>
            <select
              id="gear-spec-accessoryType"
              className="form__input form__select"
              value={spec.accessoryType ?? ''}
              onChange={(event) =>
                handleSpecChange(ACCESSORY_TYPE_FIELD.key, event.target.value)
              }
            >
              <option value="">未选择</option>
              {ACCESSORY_TYPE_FIELD.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              {/* 品牌库外/以后新增的写法不在内置列表里，也要能原样显示、不被改掉 */}
              {customAccessoryType && (
                <option value={customAccessoryType}>{customAccessoryType}</option>
              )}
            </select>
          </div>
        )}

        {/* 品牌在型号前面：先定品牌再填型号更顺手，图鉴自动填充也是先品牌后型号 */}
        <div className="form__row">
          <label className="form__label" htmlFor="gear-brand">
            品牌<em>选填</em>
          </label>
          {/* 可搜索的品牌选择框：既能从内置品牌库里选，也能直接手打品牌库外的写法 */}
          <BrandPicker
            inputId="gear-brand"
            value={brand}
            onChange={setBrand}
            placeholder="例如 达亿瓦"
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="gear-name">
            装备名称<span className="form__required">*</span>
          </label>
          <input
            id="gear-name"
            className="form__input"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (error) setError(null)
            }}
            placeholder={`例如 ${NAME_PLACEHOLDER[category]}`}
            autoComplete="off"
          />
        </div>

        {/* 周边装备没有自由填写的规格（类型已经在上面的选择框里），这一块就不出现 */}
        {plainSpecFields.length > 0 && (
          <div className="form__row">
            <span className="form__label">
              {CATEGORY_META[category].label}规格<em>选填</em>
            </span>
            <div className="form__grid2">
              {plainSpecFields.map((field) => (
                <div className="form__sub-field" key={field.key}>
                  <label
                    className="form__sub-label"
                    htmlFor={`gear-spec-${field.key}`}
                  >
                    {field.label}
                  </label>
                  <input
                    id={`gear-spec-${field.key}`}
                    className="form__input"
                    value={spec[field.key] ?? ''}
                    onChange={(event) =>
                      handleSpecChange(field.key, event.target.value)
                    }
                    placeholder={field.placeholder}
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="form__row">
          <span className="form__label">装备照片<em>选填</em></span>

          <GearImage
            category={category}
            name={name.trim() || CATEGORY_META[category].label}
            userImageUrl={previewUrl}
            photo={selectedProduct?.photo ?? null}
            variant="cover"
          />

          <div className="photo-actions">
            <label className="photo-btn">
              {previewUrl ? '替换照片' : '上传照片'}
              <input
                className="photo-btn__input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePickFile}
              />
            </label>

            {previewUrl && (
              <button
                type="button"
                className="photo-btn photo-btn--danger"
                onClick={handleRemoveImage}
              >
                删除照片
              </button>
            )}

            {/* AI 能力尚未接入，这里只预留入口 */}
            <button
              type="button"
              className="photo-btn photo-btn--disabled"
              disabled
              title="AI 美化功能即将推出"
            >
              ✨ AI 美化
              <span className="photo-btn__soon">即将推出</span>
            </button>
          </div>

          <p className="photo-hint">
            支持 JPG / PNG / WebP，单张不超过 5MB；照片保存在本机浏览器里
          </p>
          {imageError && (
            <p className="form__error" role="alert">
              <CloseIcon size={14} />
              {imageError}
            </p>
          )}
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="gear-date">
            入手日期
          </label>
          <input
            id="gear-date"
            type="date"
            className="form__input"
            value={purchasedAt}
            onChange={(event) => setPurchasedAt(event.target.value)}
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="gear-note">
            备注<em>选填</em>
          </label>
          <textarea
            id="gear-note"
            className="form__textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="搭配、适用场景、使用心得…"
            rows={3}
          />
        </div>

        <label className="form__switch-row" htmlFor="gear-favorite">
          <span className="form__switch-text">
            设为常用装备
            <em>常用的装备会标记星标，方便出门前快速确认</em>
          </span>
          <ToggleSwitch
            id="gear-favorite"
            checked={favorite}
            onChange={setFavorite}
            label="设为常用装备"
          />
        </label>

        {error && (
          <p className="form__error" role="alert">
            <CloseIcon size={14} />
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
