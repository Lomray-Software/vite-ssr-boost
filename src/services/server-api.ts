/**
 * Allow to configure server on fly
 */
class ServerApi {
  /**
   * Block access to index.html
   */
  protected isAllowIndexHtml = false;

  /**
   * Server can return index.html
   */
  public hasAccessIndexHtml(): boolean {
    return this.isAllowIndexHtml;
  }

  /**
   * Allow/disallow return index.html on request
   */
  public changeAccessIndexHtml(isAllowed: boolean): void {
    this.isAllowIndexHtml = isAllowed;
  }
}

export default ServerApi;
