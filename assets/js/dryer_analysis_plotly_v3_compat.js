const IS_DRYER_RECORDS = /\/dryer_table_records\.html$/.test(window.location.pathname);

if (IS_DRYER_RECORDS) {
  const normalizeTitle = (target) => {
    if (!target || typeof target !== "object") return;
    if (typeof target.title === "string") target.title = { text: target.title };
    if (target.titlefont) {
      if (!target.title || typeof target.title !== "object") target.title = { text: "" };
      target.title.font = { ...(target.title.font || {}), ...target.titlefont };
      delete target.titlefont;
    }
  };

  const normalizeLayout = (layout) => {
    if (!layout || typeof layout !== "object") return layout;
    normalizeTitle(layout);
    Object.entries(layout).forEach(([key, value]) => {
      if (/^[xy]axis\d*$/.test(key)) normalizeTitle(value);
    });
    return layout;
  };

  const wrapPlotly = (plotly) => {
    if (!plotly || plotly.__dryerAnalysisV3Compat) return plotly;

    const originalReact = typeof plotly.react === "function" ? plotly.react.bind(plotly) : null;
    const originalNewPlot = typeof plotly.newPlot === "function" ? plotly.newPlot.bind(plotly) : null;

    if (originalReact) {
      plotly.react = (graphDiv, data, layout, config) => {
        const safeLayout = normalizeLayout(layout);
        try {
          const result = originalReact(graphDiv, data, safeLayout, config);
          if (result && typeof result.catch === "function" && originalNewPlot) {
            return result.catch((error) => {
              console.warn("Dryer Analysis Plotly.react failed; retrying with newPlot.", error);
              return originalNewPlot(graphDiv, data, safeLayout, config);
            });
          }
          return result;
        } catch (error) {
          if (!originalNewPlot) throw error;
          console.warn("Dryer Analysis Plotly.react threw; retrying with newPlot.", error);
          return originalNewPlot(graphDiv, data, safeLayout, config);
        }
      };
    }

    Object.defineProperty(plotly, "__dryerAnalysisV3Compat", {
      value: true,
      configurable: true
    });
    return plotly;
  };

  if (window.Plotly) {
    wrapPlotly(window.Plotly);
  } else {
    let assignedPlotly;
    try {
      Object.defineProperty(window, "Plotly", {
        configurable: true,
        get() {
          return assignedPlotly;
        },
        set(value) {
          assignedPlotly = wrapPlotly(value);
          Object.defineProperty(window, "Plotly", {
            value: assignedPlotly,
            writable: true,
            configurable: true
          });
        }
      });
    } catch (error) {
      console.warn("Unable to install Dryer Analysis Plotly v3 compatibility hook.", error);
    }
  }
}
