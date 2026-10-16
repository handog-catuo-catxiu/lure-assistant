/**
 * 高德地图 JS API 2.0 的最小类型声明。
 *
 * 只声明 LureMate 实际用到的部分：地图、标记、线、圆、信息窗、
 * 逆地理编码（Geocoder）、POI 搜索（PlaceSearch）。
 *
 * 为什么不用 `@types/amap-js-api`：那套类型是对着 1.4 写的，
 * 与 2.0 的 API 有不少出入（回调签名、插件加载方式等），
 * 用错了反而会被类型误导。这里按官方 2.0 文档手写用到的这一小块。
 *
 * 脚本通过 src/lib/amap/loader.ts 动态加载，加载完成后挂在 window.AMap 上。
 */

declare global {
  namespace AMap {
    /** 高德地图上的点，顺序是 [经度, 纬度]，且必须是 GCJ-02 */
    type LngLatLike = [number, number] | { lng: number; lat: number } | LngLat

    class LngLat {
      constructor(lng: number, lat: number)
      lng: number
      lat: number
      getLng(): number
      getLat(): number
    }

    class Pixel {
      constructor(x: number, y: number)
    }

    class Bounds {
      contains(point: LngLatLike): boolean
      getCenter(): LngLat
    }

    interface MapOptions {
      zoom?: number
      center?: LngLatLike
      viewMode?: '2D' | '3D'
      resizeEnable?: boolean
      rotateEnable?: boolean
      pitchEnable?: boolean
      dragEnable?: boolean
      zoomEnable?: boolean
      doubleClickZoom?: boolean
      scrollWheel?: boolean
      showLabel?: boolean
      zooms?: [number, number]
      mapStyle?: string
    }

    class Map {
      constructor(container: HTMLElement | string, options?: MapOptions)
      add(overlay: unknown | unknown[]): void
      remove(overlay: unknown | unknown[]): void
      clearMap(): void
      destroy(): void
      resize(): void
      setFitView(
        overlays?: unknown[],
        immediately?: boolean,
        avoid?: [number, number, number, number],
        maxZoom?: number,
      ): void
      getBounds(): Bounds | null
      getZoom(): number
      setZoom(zoom: number): void
      getCenter(): LngLat | null
      setCenter(position: LngLatLike): void
      setZoomAndCenter(zoom: number, position: LngLatLike): void
      setMapStyle(style: string): void
      panTo(position: LngLatLike): void
      on(event: string, handler: (...args: never[]) => void): void
      off(event: string, handler?: (...args: never[]) => void): void
    }

    interface MarkerOptions {
      position?: LngLatLike
      /** 自定义图形：可以直接给 DOM 节点，避免拼接 HTML 字符串 */
      content?: string | HTMLElement
      anchor?: 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
      offset?: Pixel
      zIndex?: number
      visible?: boolean
      clickable?: boolean
      title?: string
      extData?: unknown
    }

    class Marker {
      constructor(options?: MarkerOptions)
      setPosition(position: LngLatLike): void
      getPosition(): LngLat
      setMap(map: Map | null): void
      show(): void
      hide(): void
      on(event: string, handler: (event: { lnglat: LngLat }) => void): void
      off(event: string, handler?: (event: { lnglat: LngLat }) => void): void
      getExtData(): unknown
    }

    interface PolylineOptions {
      path?: LngLatLike[]
      strokeColor?: string
      strokeWeight?: number
      strokeOpacity?: number
      strokeStyle?: 'solid' | 'dashed'
      lineJoin?: 'round' | 'bevel' | 'miter'
      lineCap?: 'butt' | 'round' | 'square'
      showDir?: boolean
      zIndex?: number
      clickable?: boolean
    }

    class Polyline {
      constructor(options?: PolylineOptions)
      setPath(path: LngLatLike[]): void
      setMap(map: Map | null): void
    }

    interface CircleMarkerOptions {
      center?: LngLatLike
      radius?: number
      strokeColor?: string
      strokeWeight?: number
      strokeOpacity?: number
      fillColor?: string
      fillOpacity?: number
      zIndex?: number
      clickable?: boolean
      bubble?: boolean
    }

    /** 像素半径的实心圆点，用来画标点 */
    class CircleMarker {
      constructor(options?: CircleMarkerOptions)
      setCenter(center: LngLatLike): void
      setMap(map: Map | null): void
      on(event: string, handler: (event: never) => void): void
      off(event: string, handler?: (event: never) => void): void
    }

    interface CircleOptions {
      center?: LngLatLike
      radius?: number
      strokeColor?: string
      strokeWeight?: number
      strokeOpacity?: number
      fillColor?: string
      fillOpacity?: number
      zIndex?: number
      clickable?: boolean
    }

    class Circle {
      constructor(options?: CircleOptions)
      setCenter(center: LngLatLike): void
      setRadius(radius: number): void
      setMap(map: Map | null): void
    }

    interface InfoWindowOptions {
      isCustom?: boolean
      offset?: Pixel
      autoMove?: boolean
    }

    class InfoWindow {
      constructor(options?: InfoWindowOptions)
      setContent(content: string | HTMLElement): void
      open(map: Map, position: LngLatLike): void
      close(): void
    }

    /* ------------------------------ 定位插件 ------------------------------ */

    /**
     * `AMap.Geolocation` 的构造参数。
     * 默认值来自插件源码：convert=true、needAddress=false、enableHighAccuracy=false、
     * timeout=10000、maximumAge=0、showButton/showCircle/showMarker/panToLocation=true、
     * GeoLocationFirst=是否移动端、noIpLocate=0、noGeoLocation=0、useNative=false。
     */
    interface GeolocationOptions {
      /** 是否高精度定位 */
      enableHighAccuracy?: boolean
      /** 单次定位超时（毫秒） */
      timeout?: number
      /** 接受多久以内的缓存读数（毫秒） */
      maximumAge?: number
      /** 是否把结果转成高德坐标（GCJ-02），默认 true */
      convert?: boolean
      /** 是否优先用浏览器/设备定位，失败再退到 IP 定位 */
      GeoLocationFirst?: boolean
      /** 0 允许 IP 定位；1 禁止；2 只用 IP；3 不用任何 IP */
      noIpLocate?: number
      /** 同上，控制浏览器定位的使用方式 */
      noGeoLocation?: number
      /** 是否用高德 App / SDK 的辅助定位（安卓 WebView 内） */
      useNative?: boolean
      /** 是否顺带返回地址（本项目用 Geocoder 单独查，避免每次定位都发请求） */
      needAddress?: boolean
      extensions?: 'base' | 'all'
      getCityWhenFail?: boolean
      /** 以下都是界面上那个定位按钮 / 标记 / 精度圈：本项目自己画，全部关掉 */
      showButton?: boolean
      showMarker?: boolean
      showCircle?: boolean
      panToLocation?: boolean
      zoomToAccuracy?: boolean
      position?: string
      offset?: Pixel
    }

    /**
     * 定位结果。成功时 status/code/info/message 都在，失败时只有
     * `{status: 1, code, info, message}`。字段含义按插件源码：
     * - `location_type`：'html5'（设备定位）| 'ip'（IP 定位）| 'ipcity' | 'sdk'
     * - `isConverted`：拿到的 position 是否**已经**是高德坐标
     * - `accuracy`：IP 定位时为 null
     * - `message`：插件把每一步的说明拼在里面，坐标转换成功与否只能从这里看出来
     */
    interface GeolocationResult {
      status?: number
      code?: number
      info?: string
      message?: string
      position?: LngLat
      accuracy?: number | null
      location_type?: string
      isConverted?: boolean
      formattedAddress?: string
      addressComponent?: AddressComponent
    }

    type GeolocationCallback = (status: string, result: GeolocationResult) => void

    /**
     * 只声明本项目真正用到的方法。
     *
     * 插件还有 `watchPosition()` / `clearWatch()`，但这里是**故意不声明**的：
     * 它的 watch 内部是 10 秒轮询，而且 `clearWatch()` 之后同一个实例再也开不起来
     * （暂停 → 继续会静默失效）。持续定位由 `lib/amap/geolocation.ts` 自己按
     * 同样的节奏调 `getCurrentPosition()`，全项目只有一条循环。
     */
    class Geolocation {
      constructor(options?: GeolocationOptions)
      getCurrentPosition(callback: GeolocationCallback): void
      getCityInfo(callback: (status: string, result: unknown) => void): void
    }

    /** 服务回调的统一签名：status 为 'complete' 且 result.info 为 'OK' 才算成功 */
    type ServiceCallback<T> = (status: string, result: T) => void

    interface AddressComponent {
      province: string | string[]
      city: string | string[]
      citycode?: string
      district: string | string[]
      township: string | string[]
      street?: string | string[]
      streetNumber?: { street?: string; number?: string } | Record<string, never>
      neighborhood?: { name?: string } | Record<string, never>
      building?: { name?: string } | Record<string, never>
    }

    interface Poi {
      id?: string
      name: string
      type?: string
      address?: string
      /** 高德返回的 distance 是字符串，这里如实标出来，由调用方自己解析 */
      distance?: number | string
      location?: LngLat | null
    }

    interface ReGeocode {
      formatted_address?: string
      addressComponent?: AddressComponent
      pois?: Poi[]
      roads?: unknown[]
    }

    interface GeocodeResult {
      info: string
      regeocode?: ReGeocode
    }

    interface GeocoderOptions {
      city?: string
      radius?: number
      extensions?: 'base' | 'all'
      lang?: string
    }

    class Geocoder {
      constructor(options?: GeocoderOptions)
      getAddress(
        location: LngLatLike,
        callback: ServiceCallback<GeocodeResult>,
      ): void
      getLocation(
        address: string,
        callback: ServiceCallback<{ info: string; geocodes?: unknown[] }>,
      ): void
    }

    interface PoiList {
      pois: Poi[]
      count?: number
      pageIndex?: number
      pageSize?: number
    }

    interface PlaceSearchResult {
      info: string
      poiList?: PoiList
    }

    interface PlaceSearchOptions {
      city?: string
      citylimit?: boolean
      pageSize?: number
      pageIndex?: number
      extensions?: 'base' | 'all'
      type?: string
      map?: Map
      panel?: string | HTMLElement
    }

    class PlaceSearch {
      constructor(options?: PlaceSearchOptions)
      search(keyword: string, callback: ServiceCallback<PlaceSearchResult>): void
      searchNearBy(
        keyword: string,
        center: LngLatLike,
        radius: number,
        callback: ServiceCallback<PlaceSearchResult>,
      ): void
    }

    /** 按需加载插件；也可以像本项目一样直接在 script 的 plugin 参数里带上 */
    function plugin(names: string[], callback: () => void): void
  }

  interface Window {
    /** 脚本加载完成后由高德挂上来的命名空间 */
    AMap?: typeof AMap
    /**
     * 安全密钥配置，**必须在加载脚本之前**设置。
     * 本项目只设置 serviceHost（自建代理），不把安全密钥写进前端代码。
     */
    _AMapSecurityConfig?: {
      serviceHost?: string
      securityJsCode?: string
    }
  }
}

export {}
