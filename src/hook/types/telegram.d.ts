import { Api } from "telegram";

/**
 * 扩展 Message，添加一个延迟删除的 hook 方法
 */
declare module "telegram" {
  namespace Api {
    interface Message {
      /**
       * 删除消息，但会先等待指定的毫秒数。
       *
       * @param delay 等待的时间（毫秒）
       * @param shouldThrowError 是否在删除失败时抛出错误，默认为 false
       * @example
       * ```ts
       * await msg.deleteWithDelay(2000);
       * ```
       */
      deleteWithDelay(
        delay: number,
        shouldThrowError?: boolean
      ): Promise<Api.messages.AffectedMessages[] | undefined>;
    }
  }
}
